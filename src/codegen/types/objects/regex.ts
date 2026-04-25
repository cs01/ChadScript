import { IGeneratorContext } from "../../infrastructure/generator-context.js";
import { emitZext, emitSitofp, emitSub, emitAdd } from "../../infrastructure/ir-builders.js";

// ============================================
// REGEX GENERATOR - Regex operations
// ============================================

/**
 * Regex generator with explicit context dependency.
 * No longer uses callback binding - receives context via constructor.
 */
export class RegexGenerator {
  constructor(private ctx: IGeneratorContext) {}

  // Helper methods delegate to context
  private nextTemp(): string {
    return this.ctx.nextTemp();
  }
  private nextString(): string {
    return this.ctx.nextString();
  }
  private nextLabel(prefix: string): string {
    return this.ctx.nextLabel(prefix);
  }
  private emit(instruction: string): void {
    this.ctx.emit(instruction);
  }

  private emitCompileCheck(compileResult: string, patternPtr: string): void {
    const failed = this.ctx.emitIcmp("ne", "i32", compileResult, "0");
    const failLabel = this.nextLabel("regex_fail");
    const okLabel = this.nextLabel("regex_ok");
    this.ctx.emitBrCond(failed, failLabel, okLabel);
    this.ctx.emitLabel(failLabel);
    const stderrPtr = this.nextTemp();
    this.emit(`${stderrPtr} = load i8*, i8** @stderr`);
    const fmtStr = this.ctx.createStringConstant("Error: invalid regex pattern: %s\n");
    const fprintfResult = this.nextTemp();
    this.emit(
      `${fprintfResult} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* ${fmtStr}, i8* ${patternPtr})`,
    );
    this.emit("call void @exit(i32 1)");
    this.emit("unreachable");
    this.ctx.emitLabel(okLabel);
  }

  private byteToHex(b: number): string {
    const hexChars = "0123456789ABCDEF";
    const hi = hexChars.charAt((b >> 4) & 0xf);
    const lo = hexChars.charAt(b & 0xf);
    return hi + lo;
  }

  private translateJSPatternToPOSIX(pattern: string): string {
    let result = "";
    let inBracket = false;
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "\\" && i + 1 < pattern.length) {
        const next = pattern[i + 1];
        if (next === "d") {
          result += inBracket ? "0-9" : "[0-9]";
          i++;
          continue;
        }
        if (next === "D") {
          result += inBracket ? "^0-9" : "[^0-9]";
          i++;
          continue;
        }
        if (next === "w") {
          result += inBracket ? "a-zA-Z0-9_" : "[a-zA-Z0-9_]";
          i++;
          continue;
        }
        if (next === "W") {
          result += inBracket ? "^a-zA-Z0-9_" : "[^a-zA-Z0-9_]";
          i++;
          continue;
        }
        if (next === "s") {
          result += inBracket ? " \\t\\n\\r" : "[ \\t\\n\\r]";
          i++;
          continue;
        }
        if (next === "S") {
          result += inBracket ? "^ \\t\\n\\r" : "[^ \\t\\n\\r]";
          i++;
          continue;
        }
        result += ch;
        result += next;
        i++;
        continue;
      }
      if (ch === "[" && !inBracket) {
        inBracket = true;
      } else if (ch === "]" && inBracket) {
        inBracket = false;
      }
      result += ch;
    }
    return result;
  }

  generateRegexCompile(pattern: string, flags: string): string {
    this.ctx.setUsesRegex(true);
    const posixPattern = this.translateJSPatternToPOSIX(pattern);
    let escaped = "";
    let byteCount = 0;
    for (let i = 0; i < posixPattern.length; i++) {
      const ch = posixPattern[i];
      const code = posixPattern.charCodeAt(i);
      if (ch === "\\") {
        escaped += "\\5C";
        byteCount += 1;
      } else if (ch === "\n") {
        escaped += "\\0A";
        byteCount += 1;
      } else if (ch === "\r") {
        escaped += "\\0D";
        byteCount += 1;
      } else if (ch === "\t") {
        escaped += "\\09";
        byteCount += 1;
      } else if (ch === '"') {
        escaped += "\\22";
        byteCount += 1;
      } else if (code < 32 || code > 126) {
        if (code < 128) {
          escaped += "\\" + this.byteToHex(code);
          byteCount += 1;
        } else if (code < 0x800) {
          escaped += "\\" + this.byteToHex(0xc0 | (code >> 6));
          escaped += "\\" + this.byteToHex(0x80 | (code & 0x3f));
          byteCount += 2;
        } else if (code < 0x10000) {
          escaped += "\\" + this.byteToHex(0xe0 | (code >> 12));
          escaped += "\\" + this.byteToHex(0x80 | ((code >> 6) & 0x3f));
          escaped += "\\" + this.byteToHex(0x80 | (code & 0x3f));
          byteCount += 3;
        } else {
          escaped += "\\" + this.byteToHex(0xf0 | (code >> 18));
          escaped += "\\" + this.byteToHex(0x80 | ((code >> 12) & 0x3f));
          escaped += "\\" + this.byteToHex(0x80 | ((code >> 6) & 0x3f));
          escaped += "\\" + this.byteToHex(0x80 | (code & 0x3f));
          byteCount += 4;
        }
      } else {
        escaped += ch;
        byteCount += 1;
      }
    }

    const length = byteCount + 1;
    const globalName = this.nextString();

    this.ctx.pushGlobalString(
      globalName +
        " = private unnamed_addr constant [" +
        length +
        ' x i8] c"' +
        escaped +
        '\\00", align 1',
    );

    const patternPtr = this.nextTemp();
    this.emit(
      `${patternPtr} = getelementptr inbounds [${length} x i8], [${length} x i8]* ${globalName}, i64 0, i64 0`,
    );

    const regexPtr = this.ctx.emitCall("i8*", "@cs_regex_alloc", "");

    const REG_EXTENDED = 1;
    const REG_ICASE = 2;
    const REG_NEWLINE = process.platform === "darwin" ? 8 : 4;
    let cflags = REG_EXTENDED;
    if (flags.indexOf("i") !== -1) {
      cflags = cflags | REG_ICASE;
    }
    if (flags.indexOf("m") !== -1) {
      cflags = cflags | REG_NEWLINE;
    }

    const compileResult = this.ctx.emitCall(
      "i32",
      "@cs_regex_compile",
      `i8* ${regexPtr}, i8* ${patternPtr}, i32 ${cflags}`,
    );

    this.emitCompileCheck(compileResult, patternPtr);

    return regexPtr;
  }

  generateRegexCompileRuntime(patternPtr: string, cflags: number): string {
    this.ctx.setUsesRegex(true);
    const regexPtr = this.ctx.emitCall("i8*", "@cs_regex_alloc", "");

    const compileResult = this.ctx.emitCall(
      "i32",
      "@cs_regex_compile",
      `i8* ${regexPtr}, i8* ${patternPtr}, i32 ${cflags}`,
    );

    this.emitCompileCheck(compileResult, patternPtr);

    return regexPtr;
  }

  // Test if a string matches a regex pattern
  // Returns double: 1.0 if match, 0.0 if no match (JavaScript semantics)
  generateRegexTest(regexPtr: string, testStr: string): string {
    this.ctx.setUsesRegex(true);
    const execResult = this.ctx.emitCall(
      "i32",
      "@cs_regex_exec",
      `i8* ${regexPtr}, i8* ${testStr}, i32 0, i8* null, i32 0`,
    );

    // regexec returns 0 on match, non-zero on no match
    // Convert to boolean: 0 -> 1 (match), non-zero -> 0 (no match)
    const isMatch = this.ctx.emitIcmp("eq", "i32", execResult, "0");

    const i32Result = emitZext(this.ctx, isMatch, "i1", "i32");
    const result = emitSitofp(this.ctx, i32Result, "i32");
    this.ctx.setVariableType(result, "double");

    return result;
  }

  generateRegexExecDyn(regexPtr: string, testStr: string): string {
    this.ctx.setUsesRegex(true);
    const result = this.ctx.emitCall(
      "i8*",
      "@cs_regex_exec_dyn",
      `i8* ${regexPtr}, i8* ${testStr}, i32 64`,
    );
    this.ctx.setVariableType(result, "i8*");
    return result;
  }

  // Clean up regex resources
  generateRegexFree(regexPtr: string): void {
    this.ctx.setUsesRegex(true);
    this.ctx.emitCallVoid("@cs_regex_free", `i8* ${regexPtr}`);
  }

  generateRegexSearch(regexPtr: string, testStr: string): string {
    this.ctx.setUsesRegex(true);
    const pmatchPtr = this.ctx.emitCall("i8*", "@cs_pmatch_alloc", "i32 1");
    const execResult = this.ctx.emitCall(
      "i32",
      "@cs_regex_exec",
      `i8* ${regexPtr}, i8* ${testStr}, i32 1, i8* ${pmatchPtr}, i32 0`,
    );
    const isNoMatch = this.ctx.emitIcmp("ne", "i32", execResult, "0");
    const noMatchLabel = this.nextLabel("search_nomatch");
    const matchLabel = this.nextLabel("search_found");
    const endLabel = this.nextLabel("search_end");
    this.ctx.emitBrCond(isNoMatch, noMatchLabel, matchLabel);

    this.ctx.emitLabel(noMatchLabel);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(matchLabel);
    const matchIdx = this.ctx.emitCall("i64", "@cs_pmatch_start", `i8* ${pmatchPtr}, i32 0`);
    const matchDbl = emitSitofp(this.ctx, matchIdx, "i64");
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.nextTemp();
    this.emit(`${result} = phi double [ -1.0, %${noMatchLabel} ], [ ${matchDbl}, %${matchLabel} ]`);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  generateRegexMatch(regexPtr: string, testStr: string, numGroups: number): string {
    this.ctx.setUsesRegex(true);
    const MAX_GROUPS = numGroups + 1;

    const pmatchPtr = this.ctx.emitCall("i8*", "@cs_pmatch_alloc", `i32 ${MAX_GROUPS}`);

    const execResult = this.ctx.emitCall(
      "i32",
      "@cs_regex_exec",
      `i8* ${regexPtr}, i8* ${testStr}, i32 ${MAX_GROUPS}, i8* ${pmatchPtr}, i32 0`,
    );

    const isNoMatch = this.ctx.emitIcmp("ne", "i32", execResult, "0");

    const noMatchLabel = this.nextLabel("match_nomatch");
    const matchLabel = this.nextLabel("match_found");
    const endLabel = this.nextLabel("match_end");

    this.ctx.emitBrCond(isNoMatch, noMatchLabel, matchLabel);

    this.ctx.emitLabel(noMatchLabel);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(matchLabel);

    const arrayPtr = this.ctx.emitCall("i8*", "@GC_malloc", "i64 24");
    const typedArrayPtr = this.ctx.emitBitcast(arrayPtr, "i8*", "%StringArray*");

    const dataSize = MAX_GROUPS * 8;
    const dataPtr = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
    const typedDataPtr = this.ctx.emitBitcast(dataPtr, "i8*", "i8**");

    const dataPtrField = this.nextTemp();
    this.emit(
      `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${typedArrayPtr}, i32 0, i32 0`,
    );
    this.ctx.emitStore("i8**", typedDataPtr, dataPtrField);

    const lenPtr = this.nextTemp();
    this.emit(
      `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${typedArrayPtr}, i32 0, i32 1`,
    );
    this.ctx.emitStore("i32", `${MAX_GROUPS}`, lenPtr);

    const capPtr = this.nextTemp();
    this.emit(
      `${capPtr} = getelementptr inbounds %StringArray, %StringArray* ${typedArrayPtr}, i32 0, i32 2`,
    );
    this.ctx.emitStore("i32", `${MAX_GROUPS}`, capPtr);

    for (let i = 0; i < MAX_GROUPS; i++) {
      const rmSo = this.ctx.emitCall("i64", "@cs_pmatch_start", `i8* ${pmatchPtr}, i32 ${i}`);

      const rmEo = this.ctx.emitCall("i64", "@cs_pmatch_end", `i8* ${pmatchPtr}, i32 ${i}`);

      const matchLen = emitSub(this.ctx, "i64", rmEo, rmSo);
      const matchLenPlus1 = emitAdd(this.ctx, "i64", matchLen, "1");

      const substrPtr = this.ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${matchLenPlus1}`);

      const srcPtr = this.nextTemp();
      this.emit(`${srcPtr} = getelementptr inbounds i8, i8* ${testStr}, i64 ${rmSo}`);

      const strncpyResult = this.ctx.emitCall(
        "i8*",
        "@strncpy",
        `i8* ${substrPtr}, i8* ${srcPtr}, i64 ${matchLen}`,
      );

      const nullPos = this.nextTemp();
      this.emit(`${nullPos} = getelementptr inbounds i8, i8* ${substrPtr}, i64 ${matchLen}`);
      this.ctx.emitStore("i8", "0", nullPos);

      const elemPtr = this.nextTemp();
      this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${typedDataPtr}, i64 ${i}`);
      this.ctx.emitStore("i8*", substrPtr, elemPtr);
    }

    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.nextTemp();
    this.emit(`${result} = phi i8* [ null, %${noMatchLabel} ], [ ${arrayPtr}, %${matchLabel} ]`);
    this.ctx.setVariableType(result, "i8*");

    return result;
  }
}
