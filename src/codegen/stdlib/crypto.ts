import { MethodCallNode } from "../../ast/types.js";

interface ExprBase {
  type: string;
}

import { IGeneratorContext } from "../infrastructure/generator-context.js";

export class CryptoGenerator {
  constructor(private ctx: IGeneratorContext) {}

  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "variable") return false;
    const varNode = expr.object as { type: string; name: string };
    if (varNode.name !== "crypto") return false;
    const supported = ["sha256", "md5", "sha512", "randomBytes"];
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

    const inputPtr = this.ctx.generateExpression(expr.args[0], params);

    const inputLen = this.ctx.nextTemp();
    this.ctx.emit(`${inputLen} = call i64 @strlen(i8* ${inputPtr})`);

    const mdCtx = this.ctx.nextTemp();
    this.ctx.emit(`${mdCtx} = call i8* @EVP_MD_CTX_new()`);

    const evpMd = this.ctx.nextTemp();
    this.ctx.emit(`${evpMd} = call i8* @${evpFunc}()`);

    const initResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${initResult} = call i32 @EVP_DigestInit_ex(i8* ${mdCtx}, i8* ${evpMd}, i8* null)`,
    );

    const updateResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${updateResult} = call i32 @EVP_DigestUpdate(i8* ${mdCtx}, i8* ${inputPtr}, i64 ${inputLen})`,
    );

    const hashBuf = this.ctx.nextTemp();
    this.ctx.emit(`${hashBuf} = call i8* @GC_malloc_atomic(i64 64)`);

    const hashLenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${hashLenPtr} = call i8* @GC_malloc_atomic(i64 4)`);
    const hashLenI32Ptr = this.ctx.nextTemp();
    this.ctx.emit(`${hashLenI32Ptr} = bitcast i8* ${hashLenPtr} to i32*`);

    const finalResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${finalResult} = call i32 @EVP_DigestFinal_ex(i8* ${mdCtx}, i8* ${hashBuf}, i32* ${hashLenI32Ptr})`,
    );

    this.ctx.emit(`call void @EVP_MD_CTX_free(i8* ${mdCtx})`);

    const hashLen = this.ctx.nextTemp();
    this.ctx.emit(`${hashLen} = load i32, i32* ${hashLenI32Ptr}`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__bytes_to_hex(i8* ${hashBuf}, i32 ${hashLen})`);
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
    this.ctx.emit(`${buf} = call i8* @GC_malloc_atomic(i64 ${countI64})`);

    const randResult = this.ctx.nextTemp();
    this.ctx.emit(`${randResult} = call i32 @RAND_bytes(i8* ${buf}, i32 ${countI32})`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__bytes_to_hex(i8* ${buf}, i32 ${countI32})`);
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
