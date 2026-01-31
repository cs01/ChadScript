import { BaseGenerator } from '../../../infrastructure/base-generator.js';

// ============================================
// STRING CONSTANTS - String constant creation and number conversion
// ============================================

export function createStringConstant(this: BaseGenerator, value: string): string {
  // Escape special characters for LLVM
  const escaped = value
    .replace(/\\/g, '\\5C')
    .replace(/\n/g, '\\0A')
    .replace(/\t/g, '\\09')
    .replace(/\r/g, '\\0D')
    .replace(/"/g, '\\22');

  const length = value.length + 1; // +1 for null terminator
  const globalName = this.nextString();

  // Create global constant string
  this.globalStrings.push(
    `${globalName} = private unnamed_addr constant [${length} x i8] c"${escaped}\\00", align 1`
  );

  // Return a pointer to the string
  const ptrReg = this.nextTemp();
  this.emit(
    `${ptrReg} = getelementptr inbounds [${length} x i8], [${length} x i8]* ${globalName}, i64 0, i64 0`
  );
  this.variableTypes.set(ptrReg, 'i8*');
  return ptrReg;
}

// Convert a double number to a string
export function convertNumberToString(this: BaseGenerator, numValue: string): string {
  // Convert double to i32 for printing (truncates decimal part)
  const intValue = this.nextTemp();
  this.emit(`${intValue} = fptosi double ${numValue} to i32`);

  // Allocate buffer for the string (max 12 chars for 32-bit int + null terminator)
  const bufferSize = this.nextTemp();
  this.emit(`${bufferSize} = alloca [12 x i8], align 1`);

  // Cast to i8* for snprintf
  const bufferPtr = this.nextTemp();
  this.emit(`${bufferPtr} = getelementptr inbounds [12 x i8], [12 x i8]* ${bufferSize}, i64 0, i64 0`);

  // Format string for %d
  const formatStr = createStringConstant.call(this, '%d');

  // Call snprintf to convert number to string
  const snprintfResult = this.nextTemp();
  this.emit(`${snprintfResult} = call i32 (i8*, i64, i8*, ...) @snprintf(i8* ${bufferPtr}, i64 12, i8* ${formatStr}, i32 ${intValue})`);

  // Duplicate the string on the heap so it persists
  const strLen = this.nextTemp();
  this.emit(`${strLen} = call i64 @strlen(i8* ${bufferPtr})`);

  const heapSize = this.nextTemp();
  this.emit(`${heapSize} = add i64 ${strLen}, 1`);

  const heapPtr = this.nextTemp();
  this.emit(`${heapPtr} = call i8* @malloc(i64 ${heapSize})`);

  const copyResult = this.nextTemp();
  this.emit(`${copyResult} = call i8* @strcpy(i8* ${heapPtr}, i8* ${bufferPtr})`);

  return heapPtr;
}
