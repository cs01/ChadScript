import { Expression } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// REGEX GENERATOR - Regex operations
// ============================================

export class RegexGenerator extends BaseGenerator {
  // Generate delegate for expressions (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;

  // Compile a regex pattern and return a pointer to the compiled regex
  // Returns a pointer to regex_t struct (i8*)
  generateRegexCompile(pattern: string, flags: string): string {
    // Create a global string constant for the pattern
    const escaped = pattern
      .replace(/\\/g, '\\5C')
      .replace(/\n/g, '\\0A')
      .replace(/\t/g, '\\09')
      .replace(/\r/g, '\\0D')
      .replace(/"/g, '\\"');

    const length = pattern.length + 1;
    const globalName = this.nextString();

    this.globalStrings.push(
      `${globalName} = private unnamed_addr constant [${length} x i8] c"${escaped}\\00", align 1`
    );

    const patternPtr = this.nextTemp();
    this.emit(
      `${patternPtr} = getelementptr inbounds [${length} x i8], [${length} x i8]* ${globalName}, i64 0, i64 0`
    );

    // Allocate memory for regex_t struct (approximately 32 bytes should be enough)
    const regexSize = this.nextTemp();
    this.emit(`${regexSize} = add i64 0, 32`);
    const regexPtr = this.nextTemp();
    this.emit(`${regexPtr} = call i8* @malloc(i64 ${regexSize})`);

    // Determine regex flags (for now, we'll use REG_EXTENDED = 1)
    // REG_EXTENDED = 1, REG_ICASE = 2, REG_NOSUB = 4
    let cflags = 1; // REG_EXTENDED by default
    if (flags.includes('i')) {
      cflags |= 2; // REG_ICASE
    }

    // Call regcomp(regex_t *preg, const char *pattern, int cflags)
    const compileResult = this.nextTemp();
    this.emit(
      `${compileResult} = call i32 @regcomp(i8* ${regexPtr}, i8* ${patternPtr}, i32 ${cflags})`
    );

    // For simplicity, we're not checking the compile result
    // In production, we should check if regcomp returns 0 (success)

    return regexPtr;
  }

  // Test if a string matches a regex pattern
  // Returns i32: 1 if match, 0 if no match
  generateRegexTest(regexPtr: string, testStr: string): string {
    // Call regexec(regex_t *preg, const char *string, size_t nmatch, regmatch_t pmatch[], int eflags)
    // We pass NULL for pmatch and 0 for nmatch since we don't need match positions
    const execResult = this.nextTemp();
    this.emit(
      `${execResult} = call i32 @regexec(i8* ${regexPtr}, i8* ${testStr}, i64 0, i8* null, i32 0)`
    );

    // regexec returns 0 on match, non-zero on no match
    // Convert to boolean: 0 -> 1 (match), non-zero -> 0 (no match)
    const isMatch = this.nextTemp();
    this.emit(`${isMatch} = icmp eq i32 ${execResult}, 0`);

    const result = this.nextTemp();
    this.emit(`${result} = zext i1 ${isMatch} to i32`);

    return result;
  }

  // Clean up regex resources
  generateRegexFree(regexPtr: string): void {
    // Call regfree(regex_t *preg)
    this.emit(`call void @regfree(i8* ${regexPtr})`);

    // Free the allocated memory
    this.emit(`call void @free(i8* ${regexPtr})`);
  }
}
