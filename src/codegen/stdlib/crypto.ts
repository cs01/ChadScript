import { MethodCallNode, VariableNode } from "../../ast/types.js";

interface ExprBase {
  type: string;
}

import { IGeneratorContext } from "../infrastructure/generator-context.js";

export class CryptoGenerator {
  constructor(private ctx: IGeneratorContext) {}

  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "variable") return false;
    const varNode = expr.object as VariableNode;
    if (varNode.name !== "crypto") return false;
    const supported = [
      "sha256",
      "md5",
      "sha512",
      "randomBytes",
      "randomUUID",
      "hmacSha256",
      "pbkdf2",
    ];
    return supported.indexOf(expr.method) !== -1;
  }

  generateSha256(expr: MethodCallNode, params: string[]): string {
    return this.generateHash(expr, params, "EVP_sha256");
  }

  generateMd5(expr: MethodCallNode, params: string[]): string {
    return this.generateHash(expr, params, "EVP_md5");
  }

  generateSha512(expr: MethodCallNode, params: string[]): string {
    return this.generateHash(expr, params, "EVP_sha512");
  }

  private generateHash(expr: MethodCallNode, params: string[], evpFunc: string): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError(`crypto.${expr.method}() requires 1 argument`, expr.loc);
    }

    const arg = expr.args[0];
    const isBytes = this.ctx.isUint8ArrayExpression(arg);
    const argVal = this.ctx.generateExpression(arg, params);

    let inputPtr: string;
    let inputLen: string;
    if (isBytes) {
      // %Uint8Array = type { i8*, i32, i32 } — load data ptr and length.
      const dataGep = this.ctx.nextTemp();
      this.ctx.emit(`${dataGep} = getelementptr %Uint8Array, %Uint8Array* ${argVal}, i32 0, i32 0`);
      inputPtr = this.ctx.nextTemp();
      this.ctx.emit(`${inputPtr} = load i8*, i8** ${dataGep}`);
      const lenGep = this.ctx.nextTemp();
      this.ctx.emit(`${lenGep} = getelementptr %Uint8Array, %Uint8Array* ${argVal}, i32 0, i32 1`);
      const lenI32 = this.ctx.nextTemp();
      this.ctx.emit(`${lenI32} = load i32, i32* ${lenGep}`);
      inputLen = this.ctx.nextTemp();
      this.ctx.emit(`${inputLen} = sext i32 ${lenI32} to i64`);
    } else {
      inputPtr = argVal;
      inputLen = this.ctx.nextTemp();
      this.ctx.emit(
        `${inputLen} = call i64 ${this.ctx.emitSymbol("strlen", "@")}(${this.ctx.emitOperand(inputPtr, "i8*")})`,
      );
    }

    const mdCtx = this.ctx.nextTemp();
    this.ctx.emit(`${mdCtx} = call i8* ${this.ctx.emitSymbol("EVP_MD_CTX_new", "@")}()`);

    const evpMd = this.ctx.nextTemp();
    this.ctx.emit(`${evpMd} = call i8* ${this.ctx.emitSymbol(evpFunc, "@")}()`);

    const initResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${initResult} = call i32 ${this.ctx.emitSymbol("EVP_DigestInit_ex", "@")}(${this.ctx.emitOperand(mdCtx, "i8*")}, ${this.ctx.emitOperand(evpMd, "i8*")}, i8* null)`,
    );

    const updateResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${updateResult} = call i32 ${this.ctx.emitSymbol("EVP_DigestUpdate", "@")}(${this.ctx.emitOperand(mdCtx, "i8*")}, ${this.ctx.emitOperand(inputPtr, "i8*")}, ${this.ctx.emitOperand(inputLen, "i64")})`,
    );

    const hashBuf = this.ctx.nextTemp();
    this.ctx.emit(`${hashBuf} = call i8* ${this.ctx.emitSymbol("GC_malloc_atomic", "@")}(i64 64)`);

    const hashLenPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${hashLenPtr} = call i8* ${this.ctx.emitSymbol("GC_malloc_atomic", "@")}(i64 4)`,
    );
    const hashLenI32Ptr = this.ctx.nextTemp();
    this.ctx.emit(`${hashLenI32Ptr} = bitcast i8* ${hashLenPtr} to i32*`);

    const finalResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${finalResult} = call i32 ${this.ctx.emitSymbol("EVP_DigestFinal_ex", "@")}(${this.ctx.emitOperand(mdCtx, "i8*")}, ${this.ctx.emitOperand(hashBuf, "i8*")}, ${this.ctx.emitOperand(hashLenI32Ptr, "i32*")})`,
    );

    this.ctx.emit(
      `call void ${this.ctx.emitSymbol("EVP_MD_CTX_free", "@")}(${this.ctx.emitOperand(mdCtx, "i8*")})`,
    );

    const hashLen = this.ctx.nextTemp();
    this.ctx.emit(`${hashLen} = load i32, i32* ${hashLenI32Ptr}`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = call i8* ${this.ctx.emitSymbol("__bytes_to_hex", "@")}(${this.ctx.emitOperand(hashBuf, "i8*")}, ${this.ctx.emitOperand(hashLen, "i32")})`,
    );
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  generateRandomBytes(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError(
        "crypto.randomBytes() requires 1 argument (number of bytes)",
        expr.loc,
      );
    }

    const countDouble = this.ctx.generateExpression(expr.args[0], params);
    const dblCount = this.ctx.ensureDouble(countDouble);

    const countI32 = this.ctx.nextTemp();
    this.ctx.emit(`${countI32} = fptosi double ${dblCount} to i32`);

    const countI64 = this.ctx.nextTemp();
    this.ctx.emit(`${countI64} = sext i32 ${countI32} to i64`);

    const buf = this.ctx.nextTemp();
    this.ctx.emit(
      `${buf} = call i8* ${this.ctx.emitSymbol("GC_malloc_atomic", "@")}(${this.ctx.emitOperand(countI64, "i64")})`,
    );

    const randResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${randResult} = call i32 ${this.ctx.emitSymbol("RAND_bytes", "@")}(${this.ctx.emitOperand(buf, "i8*")}, ${this.ctx.emitOperand(countI32, "i32")})`,
    );

    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = call i8* ${this.ctx.emitSymbol("__bytes_to_hex", "@")}(${this.ctx.emitOperand(buf, "i8*")}, ${this.ctx.emitOperand(countI32, "i32")})`,
    );
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  generateRandomUUID(expr: MethodCallNode, _params: string[]): string {
    const buf = this.ctx.nextTemp();
    this.ctx.emit(`${buf} = call i8* ${this.ctx.emitSymbol("GC_malloc_atomic", "@")}(i64 16)`);

    const randResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${randResult} = call i32 ${this.ctx.emitSymbol("RAND_bytes", "@")}(${this.ctx.emitOperand(buf, "i8*")}, i32 16)`,
    );

    // Set version 4: byte 6 = (byte6 & 0x0F) | 0x40
    const byte6Ptr = this.ctx.nextTemp();
    this.ctx.emit(`${byte6Ptr} = getelementptr inbounds i8, i8* ${buf}, i64 6`);
    const byte6 = this.ctx.nextTemp();
    this.ctx.emit(`${byte6} = load i8, i8* ${byte6Ptr}`);
    const byte6Masked = this.ctx.nextTemp();
    this.ctx.emit(`${byte6Masked} = and i8 ${byte6}, 15`);
    const byte6Set = this.ctx.nextTemp();
    this.ctx.emit(`${byte6Set} = or i8 ${byte6Masked}, 64`);
    this.ctx.emit(`store i8 ${byte6Set}, i8* ${byte6Ptr}`);

    // Set variant: byte 8 = (byte8 & 0x3F) | 0x80
    const byte8Ptr = this.ctx.nextTemp();
    this.ctx.emit(`${byte8Ptr} = getelementptr inbounds i8, i8* ${buf}, i64 8`);
    const byte8 = this.ctx.nextTemp();
    this.ctx.emit(`${byte8} = load i8, i8* ${byte8Ptr}`);
    const byte8Masked = this.ctx.nextTemp();
    this.ctx.emit(`${byte8Masked} = and i8 ${byte8}, 63`);
    const byte8Set = this.ctx.nextTemp();
    this.ctx.emit(`${byte8Set} = or i8 ${byte8Masked}, -128`);
    this.ctx.emit(`store i8 ${byte8Set}, i8* ${byte8Ptr}`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = call i8* ${this.ctx.emitSymbol("__uuid_format", "@")}(${this.ctx.emitOperand(buf, "i8*")})`,
    );
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  generateUuidFormatHelper(): string {
    const fmtStr = "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x";
    const fmtLen = fmtStr.length + 1;
    let ir = "";
    ir += `@.uuid_fmt = private unnamed_addr constant [${fmtLen} x i8] c"${fmtStr}\\00", align 1\n\n`;
    ir += "define i8* @__uuid_format(i8* %bytes) {\n";
    ir += "entry:\n";
    ir += "  %out = call i8* @GC_malloc_atomic(i64 37)\n";
    for (let i = 0; i < 16; i++) {
      ir += `  %p${i} = getelementptr inbounds i8, i8* %bytes, i64 ${i}\n`;
      ir += `  %b${i} = load i8, i8* %p${i}\n`;
      ir += `  %v${i} = zext i8 %b${i} to i32\n`;
    }
    ir += `  %written = call i32 (i8*, i64, i8*, ...) @snprintf(i8* %out, i64 37, i8* getelementptr([${fmtLen} x i8], [${fmtLen} x i8]* @.uuid_fmt, i32 0, i32 0)`;
    for (let i = 0; i < 16; i++) {
      ir += `, i32 %v${i}`;
    }
    ir += ")\n";
    ir += "  ret i8* %out\n";
    ir += "}\n\n";
    return ir;
  }

  generateHmacSha256(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("crypto.hmacSha256() requires 2 arguments (key, data)", expr.loc);
    }

    const keyArg = expr.args[0];
    const dataArg = expr.args[1];
    const keyIsBytes = this.ctx.isUint8ArrayExpression(keyArg);
    const dataIsBytes = this.ctx.isUint8ArrayExpression(dataArg);
    const keyVal = this.ctx.generateExpression(keyArg, params);
    const dataVal = this.ctx.generateExpression(dataArg, params);

    let keyPtr: string;
    let keyLen32: string;
    if (keyIsBytes) {
      const kDataGep = this.ctx.nextTemp();
      this.ctx.emit(
        `${kDataGep} = getelementptr %Uint8Array, %Uint8Array* ${keyVal}, i32 0, i32 0`,
      );
      keyPtr = this.ctx.nextTemp();
      this.ctx.emit(`${keyPtr} = load i8*, i8** ${kDataGep}`);
      const kLenGep = this.ctx.nextTemp();
      this.ctx.emit(`${kLenGep} = getelementptr %Uint8Array, %Uint8Array* ${keyVal}, i32 0, i32 1`);
      keyLen32 = this.ctx.nextTemp();
      this.ctx.emit(`${keyLen32} = load i32, i32* ${kLenGep}`);
    } else {
      keyPtr = keyVal;
      const keyLen64 = this.ctx.nextTemp();
      this.ctx.emit(
        `${keyLen64} = call i64 ${this.ctx.emitSymbol("strlen", "@")}(${this.ctx.emitOperand(keyPtr, "i8*")})`,
      );
      keyLen32 = this.ctx.nextTemp();
      this.ctx.emit(`${keyLen32} = trunc i64 ${keyLen64} to i32`);
    }

    let dataPtr: string;
    let dataLen: string;
    if (dataIsBytes) {
      const dDataGep = this.ctx.nextTemp();
      this.ctx.emit(
        `${dDataGep} = getelementptr %Uint8Array, %Uint8Array* ${dataVal}, i32 0, i32 0`,
      );
      dataPtr = this.ctx.nextTemp();
      this.ctx.emit(`${dataPtr} = load i8*, i8** ${dDataGep}`);
      const dLenGep = this.ctx.nextTemp();
      this.ctx.emit(
        `${dLenGep} = getelementptr %Uint8Array, %Uint8Array* ${dataVal}, i32 0, i32 1`,
      );
      const dLenI32 = this.ctx.nextTemp();
      this.ctx.emit(`${dLenI32} = load i32, i32* ${dLenGep}`);
      dataLen = this.ctx.nextTemp();
      this.ctx.emit(`${dataLen} = sext i32 ${dLenI32} to i64`);
    } else {
      dataPtr = dataVal;
      dataLen = this.ctx.nextTemp();
      this.ctx.emit(
        `${dataLen} = call i64 ${this.ctx.emitSymbol("strlen", "@")}(${this.ctx.emitOperand(dataPtr, "i8*")})`,
      );
    }

    const evpMd = this.ctx.nextTemp();
    this.ctx.emit(`${evpMd} = call i8* ${this.ctx.emitSymbol("EVP_sha256", "@")}()`);

    const outBuf = this.ctx.nextTemp();
    this.ctx.emit(`${outBuf} = call i8* ${this.ctx.emitSymbol("GC_malloc_atomic", "@")}(i64 32)`);

    const outLenMem = this.ctx.nextTemp();
    this.ctx.emit(`${outLenMem} = call i8* ${this.ctx.emitSymbol("GC_malloc_atomic", "@")}(i64 4)`);
    const outLenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${outLenPtr} = bitcast i8* ${outLenMem} to i32*`);

    const hmacResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${hmacResult} = call i8* ${this.ctx.emitSymbol("HMAC", "@")}(${this.ctx.emitOperand(evpMd, "i8*")}, ${this.ctx.emitOperand(keyPtr, "i8*")}, ${this.ctx.emitOperand(keyLen32, "i32")}, ${this.ctx.emitOperand(dataPtr, "i8*")}, ${this.ctx.emitOperand(dataLen, "i64")}, ${this.ctx.emitOperand(outBuf, "i8*")}, ${this.ctx.emitOperand(outLenPtr, "i32*")})`,
    );

    const outLen = this.ctx.nextTemp();
    this.ctx.emit(`${outLen} = load i32, i32* ${outLenPtr}`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = call i8* ${this.ctx.emitSymbol("__bytes_to_hex", "@")}(${this.ctx.emitOperand(outBuf, "i8*")}, ${this.ctx.emitOperand(outLen, "i32")})`,
    );
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  generatePbkdf2(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 4) {
      return this.ctx.emitError(
        "crypto.pbkdf2() requires 4 arguments (password, salt, iterations, keylen)",
        expr.loc,
      );
    }

    const passwordPtr = this.ctx.generateExpression(expr.args[0], params);
    const saltPtr = this.ctx.generateExpression(expr.args[1], params);
    const iterDouble = this.ctx.generateExpression(expr.args[2], params);
    const keylenDouble = this.ctx.generateExpression(expr.args[3], params);

    const passLen = this.ctx.nextTemp();
    this.ctx.emit(
      `${passLen} = call i64 ${this.ctx.emitSymbol("strlen", "@")}(${this.ctx.emitOperand(passwordPtr, "i8*")})`,
    );
    const passLen32 = this.ctx.nextTemp();
    this.ctx.emit(`${passLen32} = trunc i64 ${passLen} to i32`);

    const saltLen = this.ctx.nextTemp();
    this.ctx.emit(
      `${saltLen} = call i64 ${this.ctx.emitSymbol("strlen", "@")}(${this.ctx.emitOperand(saltPtr, "i8*")})`,
    );
    const saltLen32 = this.ctx.nextTemp();
    this.ctx.emit(`${saltLen32} = trunc i64 ${saltLen} to i32`);

    const iterD = this.ctx.ensureDouble(iterDouble);
    const iterI32 = this.ctx.nextTemp();
    this.ctx.emit(`${iterI32} = fptosi double ${iterD} to i32`);

    const keylenD = this.ctx.ensureDouble(keylenDouble);
    const keylenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${keylenI32} = fptosi double ${keylenD} to i32`);
    const keylenI64 = this.ctx.nextTemp();
    this.ctx.emit(`${keylenI64} = sext i32 ${keylenI32} to i64`);

    const outBuf = this.ctx.nextTemp();
    this.ctx.emit(
      `${outBuf} = call i8* ${this.ctx.emitSymbol("GC_malloc_atomic", "@")}(${this.ctx.emitOperand(keylenI64, "i64")})`,
    );

    const evpMd = this.ctx.nextTemp();
    this.ctx.emit(`${evpMd} = call i8* ${this.ctx.emitSymbol("EVP_sha1", "@")}()`);

    const pbkdfResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${pbkdfResult} = call i32 ${this.ctx.emitSymbol("PKCS5_PBKDF2_HMAC", "@")}(${this.ctx.emitOperand(passwordPtr, "i8*")}, ${this.ctx.emitOperand(passLen32, "i32")}, ${this.ctx.emitOperand(saltPtr, "i8*")}, ${this.ctx.emitOperand(saltLen32, "i32")}, ${this.ctx.emitOperand(iterI32, "i32")}, ${this.ctx.emitOperand(evpMd, "i8*")}, ${this.ctx.emitOperand(keylenI32, "i32")}, ${this.ctx.emitOperand(outBuf, "i8*")})`,
    );

    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = call i8* ${this.ctx.emitSymbol("__bytes_to_hex", "@")}(${this.ctx.emitOperand(outBuf, "i8*")}, ${this.ctx.emitOperand(keylenI32, "i32")})`,
    );
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  generateBytesToHexHelper(): string {
    let ir = "";
    ir +=
      '@.hex_chars = private unnamed_addr constant [17 x i8] c"0123456789abcdef\\00", align 1\n\n';
    ir += "define i8* @__bytes_to_hex(i8* %bytes, i32 %len) {\n";
    ir += "entry:\n";
    ir += "  %len_i64 = sext i32 %len to i64\n";
    ir += "  %hex_len = mul i64 %len_i64, 2\n";
    ir += "  %buf_size = add i64 %hex_len, 1\n";
    ir += "  %buf = call i8* @GC_malloc_atomic(i64 %buf_size)\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "loop:\n";
    ir += "  %i = phi i32 [ 0, %entry ], [ %next_i, %body ]\n";
    ir += "  %cmp = icmp slt i32 %i, %len\n";
    ir += "  br i1 %cmp, label %body, label %done\n";
    ir += "\n";
    ir += "body:\n";
    ir += "  %i_i64 = sext i32 %i to i64\n";
    ir += "  %byte_ptr = getelementptr inbounds i8, i8* %bytes, i64 %i_i64\n";
    ir += "  %byte = load i8, i8* %byte_ptr\n";
    ir += "  %byte_i32 = zext i8 %byte to i32\n";
    ir += "  %hi_nibble = lshr i32 %byte_i32, 4\n";
    ir += "  %lo_nibble = and i32 %byte_i32, 15\n";
    ir += "  %hi_i64 = sext i32 %hi_nibble to i64\n";
    ir += "  %lo_i64 = sext i32 %lo_nibble to i64\n";
    ir +=
      "  %hi_char_ptr = getelementptr inbounds [17 x i8], [17 x i8]* @.hex_chars, i64 0, i64 %hi_i64\n";
    ir +=
      "  %lo_char_ptr = getelementptr inbounds [17 x i8], [17 x i8]* @.hex_chars, i64 0, i64 %lo_i64\n";
    ir += "  %hi_char = load i8, i8* %hi_char_ptr\n";
    ir += "  %lo_char = load i8, i8* %lo_char_ptr\n";
    ir += "  %out_idx = mul i32 %i, 2\n";
    ir += "  %out_idx_i64 = sext i32 %out_idx to i64\n";
    ir += "  %out_hi_ptr = getelementptr inbounds i8, i8* %buf, i64 %out_idx_i64\n";
    ir += "  store i8 %hi_char, i8* %out_hi_ptr\n";
    ir += "  %out_lo_idx = add i32 %out_idx, 1\n";
    ir += "  %out_lo_idx_i64 = sext i32 %out_lo_idx to i64\n";
    ir += "  %out_lo_ptr = getelementptr inbounds i8, i8* %buf, i64 %out_lo_idx_i64\n";
    ir += "  store i8 %lo_char, i8* %out_lo_ptr\n";
    ir += "  %next_i = add i32 %i, 1\n";
    ir += "  br label %loop\n";
    ir += "\n";
    ir += "done:\n";
    ir += "  %null_idx_i64 = mul i64 %len_i64, 2\n";
    ir += "  %null_ptr = getelementptr inbounds i8, i8* %buf, i64 %null_idx_i64\n";
    ir += "  store i8 0, i8* %null_ptr\n";
    ir += "  ret i8* %buf\n";
    ir += "}\n\n";
    return ir;
  }
}
