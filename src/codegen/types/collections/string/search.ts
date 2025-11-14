import { BaseGenerator } from '../../../infrastructure/base-generator.js';

// ============================================
// STRING SEARCH - String search and query operations
// ============================================

export function generateStartsWith(this: BaseGenerator, strPtr: string, prefix: string): string {
  const prefixLen = this.nextTemp();
  this.emit(`${prefixLen} = call i64 @strlen(i8* ${prefix})`);

  const cmpResult = this.nextTemp();
  this.emit(`${cmpResult} = call i32 @strncmp(i8* ${strPtr}, i8* ${prefix}, i64 ${prefixLen})`);

  const result = this.nextTemp();
  this.emit(`${result} = icmp eq i32 ${cmpResult}, 0`);

  const resultI32 = this.nextTemp();
  this.emit(`${resultI32} = zext i1 ${result} to i32`);

  return resultI32;
}

export function generateCharAt(this: BaseGenerator, strPtr: string, index: string): string {
  // Get the character at the given index and return it as a single-character string

  // Convert index to i64 for getelementptr
  const indexI64 = this.nextTemp();
  this.emit(`${indexI64} = sext i32 ${index} to i64`);

  // Get pointer to the character at index
  const charPtr = this.nextTemp();
  this.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${indexI64}`);

  // Load the character
  const charI8 = this.nextTemp();
  this.emit(`${charI8} = load i8, i8* ${charPtr}`);

  // Allocate a 2-byte buffer for single-char string (char + null terminator)
  const resultPtr = this.nextTemp();
  this.emit(`${resultPtr} = call i8* @malloc(i64 2)`);

  // Store the character in the buffer
  this.emit(`store i8 ${charI8}, i8* ${resultPtr}`);

  // Store null terminator
  const nullPtr = this.nextTemp();
  this.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${resultPtr}, i64 1`);
  this.emit(`store i8 0, i8* ${nullPtr}`);

  return resultPtr;
}

export function generateIndexOf(this: BaseGenerator, strPtr: string, substring: string): string {
  // Use strstr to find the substring
  const foundPtr = this.nextTemp();
  this.emit(`${foundPtr} = call i8* @strstr(i8* ${strPtr}, i8* ${substring})`);

  // Check if substring was found (strstr returns NULL if not found)
  const isNull = this.nextTemp();
  this.emit(`${isNull} = icmp eq i8* ${foundPtr}, null`);

  const notFoundLabel = this.nextLabel('indexof_notfound');
  const foundLabel = this.nextLabel('indexof_found');
  const endLabel = this.nextLabel('indexof_end');

  this.emit(`br i1 ${isNull}, label %${notFoundLabel}, label %${foundLabel}`);

  // Not found - return -1
  this.emit(`${notFoundLabel}:`);
  this.emit(`br label %${endLabel}`);

  // Found - calculate index by subtracting pointers
  this.emit(`${foundLabel}:`);
  const strPtrInt = this.nextTemp();
  this.emit(`${strPtrInt} = ptrtoint i8* ${strPtr} to i64`);
  const foundPtrInt = this.nextTemp();
  this.emit(`${foundPtrInt} = ptrtoint i8* ${foundPtr} to i64`);
  const indexI64 = this.nextTemp();
  this.emit(`${indexI64} = sub i64 ${foundPtrInt}, ${strPtrInt}`);
  const indexI32 = this.nextTemp();
  this.emit(`${indexI32} = trunc i64 ${indexI64} to i32`);
  this.emit(`br label %${endLabel}`);

  // End - phi node to select result (-1 or index)
  this.emit(`${endLabel}:`);
  const resultI32 = this.nextTemp();
  this.emit(`${resultI32} = phi i32 [ -1, %${notFoundLabel} ], [ ${indexI32}, %${foundLabel} ]`);

  // Convert to double for compatibility with ChadScript's numeric type
  const result = this.nextTemp();
  this.emit(`${result} = sitofp i32 ${resultI32} to double`);

  return result;
}

export function generateIncludes(this: BaseGenerator, strPtr: string, substring: string): string {
  // Use strstr to find the substring
  const foundPtr = this.nextTemp();
  this.emit(`${foundPtr} = call i8* @strstr(i8* ${strPtr}, i8* ${substring})`);

  // Check if substring was found (strstr returns NULL if not found)
  // Return 1 if found (not null), 0 if not found (null)
  const isNull = this.nextTemp();
  this.emit(`${isNull} = icmp ne i8* ${foundPtr}, null`);

  // Convert i1 to i32, then to double for compatibility
  const resultI32 = this.nextTemp();
  this.emit(`${resultI32} = zext i1 ${isNull} to i32`);

  const result = this.nextTemp();
  this.emit(`${result} = sitofp i32 ${resultI32} to double`);

  return result;
}
