import { IGeneratorContext } from '../../infrastructure/generator-context.js';

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
  private nextTemp(): string { return this.ctx.nextTemp(); }
  private nextString(): string { return this.ctx.nextString(); }
  private nextLabel(prefix: string): string { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }

  private byteToHex(b: number): string {
    const hexChars = '0123456789ABCDEF';
    const hi = hexChars.charAt((b >> 4) & 0xF);
    const lo = hexChars.charAt(b & 0xF);
    return hi + lo;
  }

  // Compile a regex pattern and return a pointer to the compiled regex
  // Returns a pointer to regex_t struct (i8*)
  generateRegexCompile(pattern: string, flags: string): string {
    this.ctx.setUsesRegex(true);
    let escaped = '';
    let byteCount = 0;
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      const code = pattern.charCodeAt(i);
      if (ch === '\\') {
        escaped += '\\5C';
        byteCount += 1;
      } else if (ch === '\n') {
        escaped += '\\0A';
        byteCount += 1;
      } else if (ch === '\r') {
        escaped += '\\0D';
        byteCount += 1;
      } else if (ch === '\t') {
        escaped += '\\09';
        byteCount += 1;
      } else if (ch === '"') {
        escaped += '\\22';
        byteCount += 1;
      } else if (code < 32 || code > 126) {
        if (code < 128) {
          escaped += '\\' + this.byteToHex(code);
          byteCount += 1;
        } else if (code < 0x800) {
          escaped += '\\' + this.byteToHex(0xC0 | (code >> 6));
          escaped += '\\' + this.byteToHex(0x80 | (code & 0x3F));
          byteCount += 2;
        } else if (code < 0x10000) {
          escaped += '\\' + this.byteToHex(0xE0 | (code >> 12));
          escaped += '\\' + this.byteToHex(0x80 | ((code >> 6) & 0x3F));
          escaped += '\\' + this.byteToHex(0x80 | (code & 0x3F));
          byteCount += 3;
        } else {
          escaped += '\\' + this.byteToHex(0xF0 | (code >> 18));
          escaped += '\\' + this.byteToHex(0x80 | ((code >> 12) & 0x3F));
          escaped += '\\' + this.byteToHex(0x80 | ((code >> 6) & 0x3F));
          escaped += '\\' + this.byteToHex(0x80 | (code & 0x3F));
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
      globalName + ' = private unnamed_addr constant [' + length + ' x i8] c"' + escaped + '\\00", align 1'
    );

    const patternPtr = this.nextTemp();
    this.emit(
      `${patternPtr} = getelementptr inbounds [${length} x i8], [${length} x i8]* ${globalName}, i64 0, i64 0`
    );

    const regexPtr = this.nextTemp();
    this.emit(`${regexPtr} = call i8* @cs_regex_alloc()`);

    const REG_EXTENDED = 1;
    const REG_ICASE = 2;
    const REG_NEWLINE = process.platform === 'darwin' ? 8 : 4;
    let cflags = REG_EXTENDED;
    if (flags.indexOf('i') !== -1) {
      cflags = cflags | REG_ICASE;
    }
    if (flags.indexOf('m') !== -1) {
      cflags = cflags | REG_NEWLINE;
    }

    const compileResult = this.nextTemp();
    this.emit(
      `${compileResult} = call i32 @cs_regex_compile(i8* ${regexPtr}, i8* ${patternPtr}, i32 ${cflags})`
    );

    // For simplicity, we're not checking the compile result
    // In production, we should check if regcomp returns 0 (success)

    return regexPtr;
  }

  generateRegexCompileRuntime(patternPtr: string, cflags: number): string {
    this.ctx.setUsesRegex(true);
    const regexPtr = this.nextTemp();
    this.emit(`${regexPtr} = call i8* @cs_regex_alloc()`);

    const compileResult = this.nextTemp();
    this.emit(
      `${compileResult} = call i32 @cs_regex_compile(i8* ${regexPtr}, i8* ${patternPtr}, i32 ${cflags})`
    );

    return regexPtr;
  }

  // Test if a string matches a regex pattern
  // Returns double: 1.0 if match, 0.0 if no match (JavaScript semantics)
  generateRegexTest(regexPtr: string, testStr: string): string {
    const execResult = this.nextTemp();
    this.emit(
      `${execResult} = call i32 @cs_regex_exec(i8* ${regexPtr}, i8* ${testStr}, i32 0, i8* null, i32 0)`
    );

    // regexec returns 0 on match, non-zero on no match
    // Convert to boolean: 0 -> 1 (match), non-zero -> 0 (no match)
    const isMatch = this.nextTemp();
    this.emit(`${isMatch} = icmp eq i32 ${execResult}, 0`);

    const i32Result = this.nextTemp();
    this.emit(`${i32Result} = zext i1 ${isMatch} to i32`);

    // Convert to double for JavaScript semantics
    const result = this.nextTemp();
    this.emit(`${result} = sitofp i32 ${i32Result} to double`);
    this.ctx.setVariableType(result, 'double');

    return result;
  }

  // Clean up regex resources
  generateRegexFree(regexPtr: string): void {
    this.emit(`call void @cs_regex_free(i8* ${regexPtr})`);
  }

  generateRegexMatch(regexPtr: string, testStr: string, numGroups: number): string {
    const MAX_GROUPS = numGroups + 1;

    const pmatchPtr = this.nextTemp();
    this.emit(`${pmatchPtr} = call i8* @cs_pmatch_alloc(i32 ${MAX_GROUPS})`);

    const execResult = this.nextTemp();
    this.emit(`${execResult} = call i32 @cs_regex_exec(i8* ${regexPtr}, i8* ${testStr}, i32 ${MAX_GROUPS}, i8* ${pmatchPtr}, i32 0)`);

    const isNoMatch = this.nextTemp();
    this.emit(`${isNoMatch} = icmp ne i32 ${execResult}, 0`);

    const noMatchLabel = this.nextLabel('match_nomatch');
    const matchLabel = this.nextLabel('match_found');
    const endLabel = this.nextLabel('match_end');

    this.emit(`br i1 ${isNoMatch}, label %${noMatchLabel}, label %${matchLabel}`);

    this.emit(`${noMatchLabel}:`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${matchLabel}:`);

    const arrayPtr = this.nextTemp();
    this.emit(`${arrayPtr} = call i8* @GC_malloc(i64 24)`);
    const typedArrayPtr = this.nextTemp();
    this.emit(`${typedArrayPtr} = bitcast i8* ${arrayPtr} to %StringArray*`);

    const dataSize = MAX_GROUPS * 8;
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = call i8* @GC_malloc(i64 ${dataSize})`);
    const typedDataPtr = this.nextTemp();
    this.emit(`${typedDataPtr} = bitcast i8* ${dataPtr} to i8**`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${typedArrayPtr}, i32 0, i32 0`);
    this.emit(`store i8** ${typedDataPtr}, i8*** ${dataPtrField}`);

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${typedArrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${MAX_GROUPS}, i32* ${lenPtr}`);

    const capPtr = this.nextTemp();
    this.emit(`${capPtr} = getelementptr inbounds %StringArray, %StringArray* ${typedArrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${MAX_GROUPS}, i32* ${capPtr}`);

    for (let i = 0; i < MAX_GROUPS; i++) {
      const rmSo = this.nextTemp();
      this.emit(`${rmSo} = call i64 @cs_pmatch_start(i8* ${pmatchPtr}, i32 ${i})`);

      const rmEo = this.nextTemp();
      this.emit(`${rmEo} = call i64 @cs_pmatch_end(i8* ${pmatchPtr}, i32 ${i})`);

      const matchLen = this.nextTemp();
      this.emit(`${matchLen} = sub i64 ${rmEo}, ${rmSo}`);

      const matchLenPlus1 = this.nextTemp();
      this.emit(`${matchLenPlus1} = add i64 ${matchLen}, 1`);

      const substrPtr = this.nextTemp();
      this.emit(`${substrPtr} = call i8* @GC_malloc_atomic(i64 ${matchLenPlus1})`);

      const srcPtr = this.nextTemp();
      this.emit(`${srcPtr} = getelementptr inbounds i8, i8* ${testStr}, i64 ${rmSo}`);

      const strncpyResult = this.nextTemp();
      this.emit(`${strncpyResult} = call i8* @strncpy(i8* ${substrPtr}, i8* ${srcPtr}, i64 ${matchLen})`);

      const nullPos = this.nextTemp();
      this.emit(`${nullPos} = getelementptr inbounds i8, i8* ${substrPtr}, i64 ${matchLen}`);
      this.emit(`store i8 0, i8* ${nullPos}`);

      const elemPtr = this.nextTemp();
      this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${typedDataPtr}, i64 ${i}`);
      this.emit(`store i8* ${substrPtr}, i8** ${elemPtr}`);
    }

    this.emit(`br label %${endLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = phi i8* [ null, %${noMatchLabel} ], [ ${arrayPtr}, %${matchLabel} ]`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }
}
