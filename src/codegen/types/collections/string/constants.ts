import { BaseGenerator } from '../../../infrastructure/base-generator.js';

// ============================================
// STRING CONSTANTS - String constant creation and number conversion
// ============================================

export function createStringConstant(ctx: BaseGenerator, value: string): string {
  const escaped = value
    .replace(/\\/g, '\\5C')
    .replace(/\n/g, '\\0A')
    .replace(/\t/g, '\\09')
    .replace(/\r/g, '\\0D')
    .replace(/"/g, '\\22');

  const length = value.length + 1;
  const globalName = ctx.nextString();

  ctx.globalStrings.push(
    `${globalName} = private unnamed_addr constant [${length} x i8] c"${escaped}\\00", align 1`
  );

  const ptrReg = ctx.nextTemp();
  ctx.emit(
    `${ptrReg} = getelementptr inbounds [${length} x i8], [${length} x i8]* ${globalName}, i64 0, i64 0`
  );
  ctx.setVariableType(ptrReg, 'i8*');
  return ptrReg;
}

export function convertNumberToString(ctx: BaseGenerator, numValue: string): string {
  const intValue = ctx.nextTemp();
  ctx.emit(`${intValue} = fptosi double ${numValue} to i32`);

  const bufferSize = ctx.nextTemp();
  ctx.emit(`${bufferSize} = alloca [12 x i8], align 1`);

  const bufferPtr = ctx.nextTemp();
  ctx.emit(`${bufferPtr} = getelementptr inbounds [12 x i8], [12 x i8]* ${bufferSize}, i64 0, i64 0`);

  const formatStr = createStringConstant(ctx, '%d');

  const snprintfResult = ctx.nextTemp();
  ctx.emit(`${snprintfResult} = call i32 (i8*, i64, i8*, ...) @snprintf(i8* ${bufferPtr}, i64 12, i8* ${formatStr}, i32 ${intValue})`);

  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${bufferPtr})`);

  const heapSize = ctx.nextTemp();
  ctx.emit(`${heapSize} = add i64 ${strLen}, 1`);

  const heapPtr = ctx.nextTemp();
  ctx.emit(`${heapPtr} = call i8* @GC_malloc_atomic(i64 ${heapSize})`);

  const copyResult = ctx.nextTemp();
  ctx.emit(`${copyResult} = call i8* @strcpy(i8* ${heapPtr}, i8* ${bufferPtr})`);

  return heapPtr;
}
