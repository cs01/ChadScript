import { IGeneratorContext } from '../../../infrastructure/generator-context.js';

// ============================================
// STRING CONSTANTS - String constant creation and number conversion
// ============================================

function byteToHex(b: number): string {
  const HEX_CHARS = '0123456789ABCDEF';
  const hi = HEX_CHARS.charAt((b >> 4) & 0xF);
  const lo = HEX_CHARS.charAt(b & 0xF);
  return hi + lo;
}

export function createStringConstant(ctx: IGeneratorContext, value: string): string {
  if (!value) {
    value = '';
  }
  let escaped = '';
  let byteCount = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = value.charCodeAt(i);
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
        escaped += '\\' + byteToHex(code);
        byteCount += 1;
      } else if (code < 0x800) {
        escaped += '\\' + byteToHex(0xC0 | (code >> 6));
        escaped += '\\' + byteToHex(0x80 | (code & 0x3F));
        byteCount += 2;
      } else if (code < 0x10000) {
        escaped += '\\' + byteToHex(0xE0 | (code >> 12));
        escaped += '\\' + byteToHex(0x80 | ((code >> 6) & 0x3F));
        escaped += '\\' + byteToHex(0x80 | (code & 0x3F));
        byteCount += 3;
      } else {
        escaped += '\\' + byteToHex(0xF0 | (code >> 18));
        escaped += '\\' + byteToHex(0x80 | ((code >> 12) & 0x3F));
        escaped += '\\' + byteToHex(0x80 | ((code >> 6) & 0x3F));
        escaped += '\\' + byteToHex(0x80 | (code & 0x3F));
        byteCount += 4;
      }
    } else {
      escaped += ch;
      byteCount += 1;
    }
  }

  const length = byteCount + 1;
  const globalName = ctx.nextString();

  const globalDecl = globalName + ' = private unnamed_addr constant [' + length + ' x i8] c"' + escaped + '\\00", align 1';
  ctx.pushGlobalString(globalDecl);

  const ptrReg = ctx.nextTemp();
  const gepInstr = ptrReg + ' = getelementptr inbounds [' + length + ' x i8], [' + length + ' x i8]* ' + globalName + ', i64 0, i64 0';
  ctx.emit(gepInstr);
  ctx.setVariableType(ptrReg, 'i8*');
  return ptrReg;
}

export function convertNumberToString(ctx: IGeneratorContext, numValue: string): string {
  const bufferSize = ctx.nextTemp();
  ctx.emit(`${bufferSize} = alloca [32 x i8], align 1`);

  const bufferPtr = ctx.nextTemp();
  ctx.emit(`${bufferPtr} = getelementptr inbounds [32 x i8], [32 x i8]* ${bufferSize}, i64 0, i64 0`);

  const formatStr = createStringConstant(ctx, '%g');

  const snprintfResult = ctx.nextTemp();
  ctx.emit(`${snprintfResult} = call i32 (i8*, i64, i8*, ...) @snprintf(i8* ${bufferPtr}, i64 32, i8* ${formatStr}, double ${numValue})`);

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
