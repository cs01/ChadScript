/**
 * Multipart form-data parser codegen.
 *
 * Generates LLVM IR for ChadScript.parseMultipart(req) which parses
 * multipart/form-data request bodies into an array of MultipartPart objects.
 * Delegates to the C bridge (c_bridges/multipart-bridge.c) for actual parsing.
 *
 * Returns: MultipartPart[] where each part has:
 *   { name: string, filename: string, contentType: string, data: string, dataLen: number }
 */

import { IGeneratorContext } from "../infrastructure/generator-context";

export class MultipartGenerator {
  private ctx: IGeneratorContext;

  constructor(ctx: IGeneratorContext) {
    this.ctx = ctx;
  }

  /**
   * Emit extern declaration for the C bridge function.
   * Called once during IR generation if parseMultipart is used.
   */
  generateDeclarations(): string {
    let ir = "; multipart parser declarations (via multipart-bridge)\n";
    // cs_parse_multipart_to_array(i8* content_type, i8* body, i64 body_len) -> %ObjectArray*
    ir += "declare i8* @cs_parse_multipart_to_array(i8*, i8*, i64)\n\n";
    return ir;
  }

  /**
   * Generate IR for ChadScript.parseMultipart(req).
   *
   * Extracts content_type (field 3), body (field 2), and body_len (field 5)
   * from the lws_bridge_request struct, then calls the C bridge parser.
   *
   * The request struct layout is:
   *   { i8* method, i8* path, i8* body, i8* content_type, i8* headers_raw, i64 body_len }
   *   fields:  0        1       2        3               4               5
   */
  generateParseMultipart(reqValue: string): string {
    const reqType = "%struct.lws_bridge_request";

    // Cast i8* request pointer to the struct type
    const reqPtr = this.ctx.nextTemp();
    this.ctx.emit(`${reqPtr} = bitcast i8* ${reqValue} to ${reqType}*`);

    // Load content_type (field 3)
    const ctPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${ctPtr} = getelementptr ${reqType}, ${reqType}* ${reqPtr}, i32 0, i32 3`,
    );
    const ctVal = this.ctx.nextTemp();
    this.ctx.emit(`${ctVal} = load i8*, i8** ${ctPtr}`);

    // Load body (field 2)
    const bodyPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${bodyPtr} = getelementptr ${reqType}, ${reqType}* ${reqPtr}, i32 0, i32 2`,
    );
    const bodyVal = this.ctx.nextTemp();
    this.ctx.emit(`${bodyVal} = load i8*, i8** ${bodyPtr}`);

    // Load body_len (field 5)
    const lenPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${lenPtr} = getelementptr ${reqType}, ${reqType}* ${reqPtr}, i32 0, i32 5`,
    );
    const lenVal = this.ctx.nextTemp();
    this.ctx.emit(`${lenVal} = load i64, i64* ${lenPtr}`);

    // Call the C bridge parser
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = call i8* @cs_parse_multipart_to_array(i8* ${ctVal}, i8* ${bodyVal}, i64 ${lenVal})`,
    );

    // The result is already an ObjectArray* (cast to i8* by the declare).
    // Cast back to %ObjectArray* for ChadScript's type system.
    const objArr = this.ctx.nextTemp();
    this.ctx.emit(`${objArr} = bitcast i8* ${result} to %ObjectArray*`);

    this.ctx.setVariableType(objArr, "%ObjectArray*");
    return objArr;
  }
}
