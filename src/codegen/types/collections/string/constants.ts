import { IGeneratorContext } from "../../../infrastructure/generator-context.js";

// ============================================
// STRING CONSTANTS - String constant creation and number conversion
// ============================================

function byteToHex(b: number): string {
  const HEX_CHARS = "0123456789ABCDEF";
  const hi = HEX_CHARS.charAt((b >> 4) & 0xf);
  const lo = HEX_CHARS.charAt(b & 0xf);
  return hi + lo;
}

export function createStringConstant(ctx: IGeneratorContext, value: string): string {
  if (!value) {
    value = "";
  }
  let escaped = "";
  let byteCount = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = value.charCodeAt(i);
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
        escaped += "\\" + byteToHex(code);
        byteCount += 1;
      } else if (code < 0x800) {
        escaped += "\\" + byteToHex(0xc0 | (code >> 6));
        escaped += "\\" + byteToHex(0x80 | (code & 0x3f));
        byteCount += 2;
      } else if (code < 0x10000) {
        escaped += "\\" + byteToHex(0xe0 | (code >> 12));
        escaped += "\\" + byteToHex(0x80 | ((code >> 6) & 0x3f));
        escaped += "\\" + byteToHex(0x80 | (code & 0x3f));
        byteCount += 3;
      } else {
        escaped += "\\" + byteToHex(0xf0 | (code >> 18));
        escaped += "\\" + byteToHex(0x80 | ((code >> 12) & 0x3f));
        escaped += "\\" + byteToHex(0x80 | ((code >> 6) & 0x3f));
        escaped += "\\" + byteToHex(0x80 | (code & 0x3f));
        byteCount += 4;
      }
    } else {
      escaped += ch;
      byteCount += 1;
    }
  }

  const length = byteCount + 1;
  const globalName = ctx.nextString();

  const globalDecl =
    globalName +
    " = private unnamed_addr constant [" +
    length +
    ' x i8] c"' +
    escaped +
    '\\00", align 1';
  ctx.pushGlobalString(globalDecl);

  const ptrReg = ctx.nextTemp();
  const gepInstr =
    ptrReg +
    " = getelementptr inbounds [" +
    length +
    " x i8], [" +
    length +
    " x i8]* " +
    globalName +
    ", i64 0, i64 0";
  ctx.emit(gepInstr);
  ctx.setVariableType(ptrReg, "i8*");
  return ptrReg;
}

export function convertNumberToString(ctx: IGeneratorContext, numValue: string): string {
  // Fast path via string-ops-bridge: integer-valued doubles (the overwhelming
  // common case) are formatted with a direct itoa instead of snprintf("%.15g"),
  // which is dominated by locale lookups and Balloc/d2b machinery. Non-integers
  // fall back to snprintf inside the bridge.
  const dblValue = ctx.ensureDouble(numValue);
  const heapPtr = ctx.emitCall("i8*", "@cs_num_to_str", `double ${dblValue}`);
  ctx.setVariableType(heapPtr, "i8*");
  return heapPtr;
}

export function convertNumberToFixed(
  ctx: IGeneratorContext,
  numValue: string,
  precisionValue: string,
): string {
  const dblPrecision = ctx.ensureDouble(precisionValue);
  const precisionI32 = ctx.nextTemp();
  ctx.emit(`${precisionI32} = fptosi double ${dblPrecision} to i32`);
  const bufferSize = ctx.nextTemp();
  ctx.emit(`${bufferSize} = alloca [64 x i8], align 1`);
  const bufferPtr = ctx.nextTemp();
  ctx.emit(
    `${bufferPtr} = getelementptr inbounds [64 x i8], [64 x i8]* ${bufferSize}, i64 0, i64 0`,
  );
  const formatStr = createStringConstant(ctx, "%.*f");
  const dblNumValue = ctx.ensureDouble(numValue);
  const snprintfResult = ctx.nextTemp();
  ctx.emit(
    `${snprintfResult} = call i32 (i8*, i64, i8*, ...) @snprintf(i8* ${bufferPtr}, i64 64, i8* ${formatStr}, i32 ${precisionI32}, double ${dblNumValue})`,
  );
  const strLen = ctx.nextTemp();
  ctx.emit(`${strLen} = call i64 @strlen(i8* ${bufferPtr})`);
  const heapSize = ctx.nextTemp();
  ctx.emit(`${heapSize} = add i64 ${strLen}, 1`);
  const heapPtr = ctx.nextTemp();
  ctx.emit(`${heapPtr} = call i8* @cs_arena_alloc(i64 ${heapSize})`);
  const copyResult2 = ctx.nextTemp();
  ctx.emit(`${copyResult2} = call i8* @strcpy(i8* ${heapPtr}, i8* ${bufferPtr})`);
  ctx.setVariableType(heapPtr, "i8*");
  return heapPtr;
}
