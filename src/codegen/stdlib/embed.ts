/** Binary-safe file embedding and serving for ChadScript.
 * Reads files as raw Buffers (not UTF-8) to preserve binary content like images. */
import * as fs from "fs";
import * as path from "path";
import { MethodCallNode } from "../../ast/types.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";

interface ExprBase {
  type: string;
}

interface StringLiteralNode {
  type: "string";
  value: string;
}

export class EmbedGenerator {
  private embeddedKeys: string[] = [];
  private embeddedStrIds: string[] = [];
  private embeddedStrLens: number[] = [];
  // Actual byte lengths of embedded content (without null terminator).
  // Used by the length lookup function to return correct sizes for binary data.
  private embeddedByteLens: number[] = [];
  private entryDir: string;
  private _lastStrId: string = "";
  private _lastLen: number = 0;
  private _lastByteLen: number = 0;

  constructor(
    private ctx: IGeneratorContext,
    filename: string,
  ) {
    this.entryDir = filename ? path.dirname(path.resolve(filename)) : process.cwd();
  }

  hasEmbeddedFiles(): boolean {
    return this.embeddedKeys.length > 0;
  }

  private escapeForLLVM(value: string): string {
    let escaped = "";
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      const code = value.charCodeAt(i);
      if (ch === "\\") {
        escaped += "\\5C";
      } else if (ch === "\n") {
        escaped += "\\0A";
      } else if (ch === "\r") {
        escaped += "\\0D";
      } else if (ch === "\t") {
        escaped += "\\09";
      } else if (ch === '"') {
        escaped += "\\22";
      } else if (code < 32 || code > 126) {
        if (code < 128) {
          escaped += "\\" + this.byteToHex(code);
        } else if (code < 0x800) {
          escaped += "\\" + this.byteToHex(0xc0 | (code >> 6));
          escaped += "\\" + this.byteToHex(0x80 | (code & 0x3f));
        } else {
          escaped += "\\" + this.byteToHex(0xe0 | (code >> 12));
          escaped += "\\" + this.byteToHex(0x80 | ((code >> 6) & 0x3f));
          escaped += "\\" + this.byteToHex(0x80 | (code & 0x3f));
        }
      } else {
        escaped += ch;
      }
    }
    return escaped;
  }

  private countUtf8Bytes(value: string): number {
    let count = 0;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 128) {
        count += 1;
      } else if (code < 0x800) {
        count += 2;
      } else {
        count += 3;
      }
    }
    return count;
  }

  private byteToHex(b: number): string {
    const hexChars = "0123456789ABCDEF";
    const hi = hexChars.charAt((b >> 4) & 0xf);
    const lo = hexChars.charAt(b & 0xf);
    return hi + lo;
  }

  /** Escape a Latin-1 string for LLVM IR — each char maps 1:1 to a byte.
   * Unlike escapeForLLVM, this does NOT apply UTF-8 multi-byte encoding.
   * Use for binary data read with "latin1" encoding. */
  private escapeLatin1ForLLVM(value: string): string {
    let escaped = "";
    for (let i = 0; i < value.length; i++) {
      const ch = value.charAt(i);
      const code = value.charCodeAt(i);
      if (ch === "\\") {
        escaped += "\\5C";
      } else if (ch === "\n") {
        escaped += "\\0A";
      } else if (ch === "\r") {
        escaped += "\\0D";
      } else if (ch === "\t") {
        escaped += "\\09";
      } else if (ch === '"') {
        escaped += "\\22";
      } else if (code < 32 || code > 126) {
        // Direct byte escape — no UTF-8 multi-byte encoding for Latin-1
        escaped += "\\" + this.byteToHex(code);
      } else {
        escaped += ch;
      }
    }
    return escaped;
  }

  private createGlobalStringDirect(value: string): void {
    const strId = this.ctx.nextString();
    const escaped = this.escapeForLLVM(value);
    const len = this.countUtf8Bytes(value) + 1;
    this.ctx.pushGlobalString(
      strId + " = private unnamed_addr constant [" + len + ' x i8] c"' + escaped + '\\00", align 1',
    );
    this._lastStrId = strId;
    this._lastLen = len;
    this._lastByteLen = len - 1;
  }

  /** Create an LLVM global constant from a Latin-1 encoded string.
   * Each char is exactly 1 byte, so content.length = byte count.
   * Self-hosting safe — no Buffer operations needed. */
  private createGlobalBinaryDirect(content: string): void {
    const strId = this.ctx.nextString();
    const escaped = this.escapeLatin1ForLLVM(content);
    const byteCount = content.length;
    const len = byteCount + 1; // +1 for null terminator
    this.ctx.pushGlobalString(
      strId + " = private unnamed_addr constant [" + len + ' x i8] c"' + escaped + '\\00", align 1',
    );
    this._lastStrId = strId;
    this._lastLen = len;
    this._lastByteLen = byteCount;
  }

  generateEmbedFile(expr: MethodCallNode, _params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("ChadScript.embedFile() requires 1 argument (file path)", expr.loc);
    }

    const argBase = expr.args[0] as ExprBase;
    if (argBase.type !== "string") {
      return this.ctx.emitError(
        "ChadScript.embedFile() argument must be a string literal",
        expr.loc,
      );
    }

    const relPath = (expr.args[0] as StringLiteralNode).value;
    const absPath = path.resolve(this.entryDir, relPath);

    if (!fs.existsSync(absPath)) {
      return this.ctx.emitError("ChadScript.embedFile(): file not found: " + absPath, expr.loc);
    }

    // Read as Latin-1 to preserve all byte values as single chars (0x00-0xFF).
    // Latin-1 is a 1:1 byte mapping — unlike UTF-8 which corrupts binary data.
    const content = fs.readFileSync(absPath, "latin1");
    this.createGlobalBinaryDirect(content);
    const strId = this._lastStrId;
    const len = this._lastLen;

    const ptrReg = this.ctx.nextTemp();
    this.ctx.emit(
      ptrReg +
        " = getelementptr inbounds [" +
        len +
        " x i8], [" +
        len +
        " x i8]* " +
        strId +
        ", i64 0, i64 0",
    );
    this.ctx.setVariableType(ptrReg, "i8*");

    const key = path.basename(relPath);
    this.embeddedKeys.push(key);
    this.embeddedStrIds.push(strId);
    this.embeddedStrLens.push(len);
    this.embeddedByteLens.push(this._lastByteLen);

    return ptrReg;
  }

  generateEmbedDir(expr: MethodCallNode, _params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError(
        "ChadScript.embedDir() requires 1 argument (directory path)",
        expr.loc,
      );
    }

    const argBase = expr.args[0] as ExprBase;
    if (argBase.type !== "string") {
      return this.ctx.emitError(
        "ChadScript.embedDir() argument must be a string literal",
        expr.loc,
      );
    }

    const relPath = (expr.args[0] as StringLiteralNode).value;
    const absPath = path.resolve(this.entryDir, relPath);

    if (!fs.existsSync(absPath)) {
      return this.ctx.emitError("ChadScript.embedDir(): directory not found: " + absPath, expr.loc);
    }

    this.walkDir(absPath, absPath);

    return "null";
  }

  private walkDir(dirPath: string, baseDir: string): void {
    const entries = fs.readdirSync(dirPath);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const fullPath = path.join(dirPath, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        this.walkDir(fullPath, baseDir);
      } else {
        // Read as Latin-1 to preserve all byte values as single chars
        const content = fs.readFileSync(fullPath, "latin1");
        this.createGlobalBinaryDirect(content);
        const key = fullPath.substring(baseDir.length + 1);
        this.embeddedKeys.push(key);
        this.embeddedStrIds.push(this._lastStrId);
        this.embeddedStrLens.push(this._lastLen);
        this.embeddedByteLens.push(this._lastByteLen);
      }
    }
  }

  /**
   * ChadScript.serveEmbedded(path) — returns an HttpResponse struct pointer.
   * Strips leading "/" from path, looks up the embedded file, and returns
   * { 200.0, content, "", bodyLen } if found, or { 404.0, "Not Found", "", 0.0 } if not.
   *
   * Uses 4-field struct { double, i8*, i8*, double } where field 3 is bodyLen.
   * The bodyLen field lets the HTTP handler wrapper send the exact byte count
   * instead of relying on strlen, which truncates at null bytes in binary data.
   */
  generateServeEmbedded(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("ChadScript.serveEmbedded() requires 1 argument (path)", expr.loc);
    }

    const respType = "{ double, i8*, i8*, double }";
    // 8 (double) + 8 (i8*) + 8 (i8*) + 8 (double) = 32 bytes
    const structSize = "32";

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    // Strip leading "/" from path: if path[0] == '/', advance by 1
    const firstChar = this.ctx.nextTemp();
    this.ctx.emit(firstChar + " = load i8, i8* " + pathPtr);
    const isSlash = this.ctx.nextTemp();
    this.ctx.emit(isSlash + " = icmp eq i8 " + firstChar + ", 47"); // '/' = 47
    // Allocate onePtr first since its defining instruction (GEP) must precede
    // the select that uses it -- SSA temps must be defined in ascending order.
    const onePtr = this.ctx.nextTemp();
    this.ctx.emit(onePtr + " = getelementptr i8, i8* " + pathPtr + ", i64 1");
    const stripped = this.ctx.nextTemp();
    this.ctx.emit(stripped + " = select i1 " + isSlash + ", i8* " + onePtr + ", i8* " + pathPtr);

    // Look up the embedded file content and byte length
    const content = this.ctx.nextTemp();
    this.ctx.emit(content + " = call i8* @__cs_get_embedded_file(i8* " + stripped + ")");
    const contentLen = this.ctx.nextTemp();
    this.ctx.emit(contentLen + " = call i64 @__cs_get_embedded_file_len(i8* " + stripped + ")");

    // Check if found using byte length > 0 (binary-safe, no strlen truncation)
    const found = this.ctx.nextTemp();
    this.ctx.emit(found + " = icmp ugt i64 " + contentLen + ", 0");

    const foundLabel = this.ctx.nextLabel("serve_found");
    const notFoundLabel = this.ctx.nextLabel("serve_notfound");
    const joinLabel = this.ctx.nextLabel("serve_join");

    this.ctx.emit("br i1 " + found + ", label %" + foundLabel + ", label %" + notFoundLabel);

    // Found: allocate { 200.0, content, "", bodyLen }
    this.ctx.emit(foundLabel + ":");
    const foundStruct = this.ctx.nextTemp();
    this.ctx.emit(foundStruct + " = call i8* @GC_malloc(i64 " + structSize + ")");
    const foundTyped = this.ctx.nextTemp();
    this.ctx.emit(foundTyped + " = bitcast i8* " + foundStruct + " to " + respType + "*");
    // Field 0: status = 200.0
    const fStatusPtr = this.ctx.nextTemp();
    this.ctx.emit(
      fStatusPtr +
        " = getelementptr " +
        respType +
        ", " +
        respType +
        "* " +
        foundTyped +
        ", i32 0, i32 0",
    );
    this.ctx.emit("store double 200.0, double* " + fStatusPtr);
    // Field 1: body = content pointer
    const fBodyPtr = this.ctx.nextTemp();
    this.ctx.emit(
      fBodyPtr +
        " = getelementptr " +
        respType +
        ", " +
        respType +
        "* " +
        foundTyped +
        ", i32 0, i32 1",
    );
    this.ctx.emit("store i8* " + content + ", i8** " + fBodyPtr);
    // Field 2: headers = empty string
    this.createGlobalStringDirect("");
    const emptyStrId = this._lastStrId;
    const emptyStrLen = this._lastLen;
    const emptyStr = this.ctx.nextTemp();
    this.ctx.emit(
      emptyStr +
        " = getelementptr inbounds [" +
        emptyStrLen +
        " x i8], [" +
        emptyStrLen +
        " x i8]* " +
        emptyStrId +
        ", i64 0, i64 0",
    );
    const fHdrsPtr = this.ctx.nextTemp();
    this.ctx.emit(
      fHdrsPtr +
        " = getelementptr " +
        respType +
        ", " +
        respType +
        "* " +
        foundTyped +
        ", i32 0, i32 2",
    );
    this.ctx.emit("store i8* " + emptyStr + ", i8** " + fHdrsPtr);
    // Field 3: bodyLen = byte length as double
    const contentLenDbl = this.ctx.nextTemp();
    this.ctx.emit(contentLenDbl + " = sitofp i64 " + contentLen + " to double");
    const fLenPtr = this.ctx.nextTemp();
    this.ctx.emit(
      fLenPtr +
        " = getelementptr " +
        respType +
        ", " +
        respType +
        "* " +
        foundTyped +
        ", i32 0, i32 3",
    );
    this.ctx.emit("store double " + contentLenDbl + ", double* " + fLenPtr);
    this.ctx.emit("br label %" + joinLabel);

    // Not found: allocate { 404.0, "Not Found", "", 0.0 }
    this.ctx.emit(notFoundLabel + ":");
    const nfStruct = this.ctx.nextTemp();
    this.ctx.emit(nfStruct + " = call i8* @GC_malloc(i64 " + structSize + ")");
    const nfTyped = this.ctx.nextTemp();
    this.ctx.emit(nfTyped + " = bitcast i8* " + nfStruct + " to " + respType + "*");
    // Field 0: status = 404.0
    const nfStatusPtr = this.ctx.nextTemp();
    this.ctx.emit(
      nfStatusPtr +
        " = getelementptr " +
        respType +
        ", " +
        respType +
        "* " +
        nfTyped +
        ", i32 0, i32 0",
    );
    this.ctx.emit("store double 404.0, double* " + nfStatusPtr);
    // Field 1: body = "Not Found"
    this.createGlobalStringDirect("Not Found");
    const nfBodyStrId = this._lastStrId;
    const nfBodyLen = this._lastLen;
    const nfBodyStr = this.ctx.nextTemp();
    this.ctx.emit(
      nfBodyStr +
        " = getelementptr inbounds [" +
        nfBodyLen +
        " x i8], [" +
        nfBodyLen +
        " x i8]* " +
        nfBodyStrId +
        ", i64 0, i64 0",
    );
    const nfBodyPtr = this.ctx.nextTemp();
    this.ctx.emit(
      nfBodyPtr +
        " = getelementptr " +
        respType +
        ", " +
        respType +
        "* " +
        nfTyped +
        ", i32 0, i32 1",
    );
    this.ctx.emit("store i8* " + nfBodyStr + ", i8** " + nfBodyPtr);
    // Field 2: headers = empty string (reuse global)
    const emptyStr2 = this.ctx.nextTemp();
    this.ctx.emit(
      emptyStr2 +
        " = getelementptr inbounds [" +
        emptyStrLen +
        " x i8], [" +
        emptyStrLen +
        " x i8]* " +
        emptyStrId +
        ", i64 0, i64 0",
    );
    const nfHdrsPtr = this.ctx.nextTemp();
    this.ctx.emit(
      nfHdrsPtr +
        " = getelementptr " +
        respType +
        ", " +
        respType +
        "* " +
        nfTyped +
        ", i32 0, i32 2",
    );
    this.ctx.emit("store i8* " + emptyStr2 + ", i8** " + nfHdrsPtr);
    // Field 3: bodyLen = 0.0 (handler wrapper falls back to strlen)
    const nfLenPtr = this.ctx.nextTemp();
    this.ctx.emit(
      nfLenPtr +
        " = getelementptr " +
        respType +
        ", " +
        respType +
        "* " +
        nfTyped +
        ", i32 0, i32 3",
    );
    this.ctx.emit("store double 0.0, double* " + nfLenPtr);
    this.ctx.emit("br label %" + joinLabel);

    // Join: phi node to select the result
    this.ctx.emit(joinLabel + ":");
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      result +
        " = phi i8* [ " +
        foundStruct +
        ", %" +
        foundLabel +
        " ], [ " +
        nfStruct +
        ", %" +
        notFoundLabel +
        " ]",
    );
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  /**
   * ChadScript.serveFile(path) — read a file from disk and return an HttpResponse.
   * Uses fopen/fseek/fread to read binary-safe content, returns { 200, data, "", len }
   * or { 404, "Not Found", "", 0 } if the file doesn't exist.
   */
  generateServeFile(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("ChadScript.serveFile() requires 1 argument (path)", expr.loc);
    }

    const respType = "{ double, i8*, i8*, double }";
    const structSize = "32";

    // Pre-create global strings before branching
    this.createGlobalStringDirect("");
    const emptyStrId = this._lastStrId;
    const emptyStrLen = this._lastLen;
    this.createGlobalStringDirect("Not Found");
    const nfBodyStrId = this._lastStrId;
    const nfBodyLen = this._lastLen;

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);
    const modeStr = this.ctx.createStringConstant("rb");
    const filePtr = this.ctx.nextTemp();
    this.ctx.emit(`${filePtr} = call i8* @fopen(i8* ${pathPtr}, i8* ${modeStr})`);
    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${filePtr}, null`);

    const foundLabel = this.ctx.nextLabel("servefile_found");
    const notFoundLabel = this.ctx.nextLabel("servefile_notfound");
    const joinLabel = this.ctx.nextLabel("servefile_join");
    this.ctx.emit(`br i1 ${isNull}, label %${notFoundLabel}, label %${foundLabel}`);

    // Found: read file, return { 200, data, "", size }
    this.ctx.emit(`${foundLabel}:`);
    const seekEnd = this.ctx.nextTemp();
    this.ctx.emit(`${seekEnd} = call i32 @fseek(i8* ${filePtr}, i64 0, i32 2)`);
    const fileSize = this.ctx.nextTemp();
    this.ctx.emit(`${fileSize} = call i64 @ftell(i8* ${filePtr})`);
    const seekStart = this.ctx.nextTemp();
    this.ctx.emit(`${seekStart} = call i32 @fseek(i8* ${filePtr}, i64 0, i32 0)`);
    const dataBuf = this.ctx.nextTemp();
    this.ctx.emit(`${dataBuf} = call i8* @GC_malloc_atomic(i64 ${fileSize})`);
    const bytesRead = this.ctx.nextTemp();
    this.ctx.emit(
      `${bytesRead} = call i64 @fread(i8* ${dataBuf}, i64 1, i64 ${fileSize}, i8* ${filePtr})`,
    );
    const closeRes = this.ctx.nextTemp();
    this.ctx.emit(`${closeRes} = call i32 @fclose(i8* ${filePtr})`);

    const foundStruct = this.ctx.nextTemp();
    this.ctx.emit(`${foundStruct} = call i8* @GC_malloc(i64 ${structSize})`);
    const foundTyped = this.ctx.nextTemp();
    this.ctx.emit(`${foundTyped} = bitcast i8* ${foundStruct} to ${respType}*`);
    const fStatusPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fStatusPtr} = getelementptr ${respType}, ${respType}* ${foundTyped}, i32 0, i32 0`,
    );
    this.ctx.emit(`store double 200.0, double* ${fStatusPtr}`);
    const fBodyPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fBodyPtr} = getelementptr ${respType}, ${respType}* ${foundTyped}, i32 0, i32 1`,
    );
    this.ctx.emit(`store i8* ${dataBuf}, i8** ${fBodyPtr}`);
    const emptyStr = this.ctx.nextTemp();
    this.ctx.emit(
      `${emptyStr} = getelementptr inbounds [${emptyStrLen} x i8], [${emptyStrLen} x i8]* ${emptyStrId}, i64 0, i64 0`,
    );
    const fHdrsPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fHdrsPtr} = getelementptr ${respType}, ${respType}* ${foundTyped}, i32 0, i32 2`,
    );
    this.ctx.emit(`store i8* ${emptyStr}, i8** ${fHdrsPtr}`);
    const fileSizeDbl = this.ctx.nextTemp();
    this.ctx.emit(`${fileSizeDbl} = sitofp i64 ${fileSize} to double`);
    const fLenPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fLenPtr} = getelementptr ${respType}, ${respType}* ${foundTyped}, i32 0, i32 3`,
    );
    this.ctx.emit(`store double ${fileSizeDbl}, double* ${fLenPtr}`);
    this.ctx.emit(`br label %${joinLabel}`);

    // Not found: return { 404, "Not Found", "", 0 }
    this.ctx.emit(`${notFoundLabel}:`);
    const nfStruct = this.ctx.nextTemp();
    this.ctx.emit(`${nfStruct} = call i8* @GC_malloc(i64 ${structSize})`);
    const nfTyped = this.ctx.nextTemp();
    this.ctx.emit(`${nfTyped} = bitcast i8* ${nfStruct} to ${respType}*`);
    const nfStatusPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${nfStatusPtr} = getelementptr ${respType}, ${respType}* ${nfTyped}, i32 0, i32 0`,
    );
    this.ctx.emit(`store double 404.0, double* ${nfStatusPtr}`);
    const nfBodyStr = this.ctx.nextTemp();
    this.ctx.emit(
      `${nfBodyStr} = getelementptr inbounds [${nfBodyLen} x i8], [${nfBodyLen} x i8]* ${nfBodyStrId}, i64 0, i64 0`,
    );
    const nfBodyPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${nfBodyPtr} = getelementptr ${respType}, ${respType}* ${nfTyped}, i32 0, i32 1`,
    );
    this.ctx.emit(`store i8* ${nfBodyStr}, i8** ${nfBodyPtr}`);
    const emptyStr2 = this.ctx.nextTemp();
    this.ctx.emit(
      `${emptyStr2} = getelementptr inbounds [${emptyStrLen} x i8], [${emptyStrLen} x i8]* ${emptyStrId}, i64 0, i64 0`,
    );
    const nfHdrsPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${nfHdrsPtr} = getelementptr ${respType}, ${respType}* ${nfTyped}, i32 0, i32 2`,
    );
    this.ctx.emit(`store i8* ${emptyStr2}, i8** ${nfHdrsPtr}`);
    const nfLenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${nfLenPtr} = getelementptr ${respType}, ${respType}* ${nfTyped}, i32 0, i32 3`);
    this.ctx.emit(`store double 0.0, double* ${nfLenPtr}`);
    this.ctx.emit(`br label %${joinLabel}`);

    // Join
    this.ctx.emit(`${joinLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi i8* [ ${foundStruct}, %${foundLabel} ], [ ${nfStruct}, %${notFoundLabel} ]`,
    );
    this.ctx.setVariableType(result, "i8*");
    return result;
  }

  generateGetEmbeddedFile(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError(
        "ChadScript.getEmbeddedFile() requires 1 argument (file key)",
        expr.loc,
      );
    }

    const keyPtr = this.ctx.generateExpression(expr.args[0], params);

    const result = this.ctx.nextTemp();
    this.ctx.emit(result + " = call i8* @__cs_get_embedded_file(i8* " + keyPtr + ")");
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  /** ChadScript.getEmbeddedFileAsUint8Array(key) — returns embedded binary data as %Uint8Array*.
   * Calls the content + length lookup functions and wraps in a Uint8Array struct. */
  generateGetEmbeddedFileAsUint8Array(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError(
        "ChadScript.getEmbeddedFileAsUint8Array() requires 1 argument (file key)",
        expr.loc,
      );
    }

    const keyPtr = this.ctx.generateExpression(expr.args[0], params);

    // Get data pointer and byte length
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(dataPtr + " = call i8* @__cs_get_embedded_file(i8* " + keyPtr + ")");
    const byteLen = this.ctx.nextTemp();
    this.ctx.emit(byteLen + " = call i64 @__cs_get_embedded_file_len(i8* " + keyPtr + ")");
    const byteLenI32 = this.ctx.nextTemp();
    this.ctx.emit(byteLenI32 + " = trunc i64 " + byteLen + " to i32");

    // Allocate %Uint8Array struct { i8*, i32, i32 }
    const structRaw = this.ctx.nextTemp();
    this.ctx.emit(structRaw + " = call i8* @GC_malloc(i64 16)");
    const structPtr = this.ctx.nextTemp();
    this.ctx.emit(structPtr + " = bitcast i8* " + structRaw + " to %Uint8Array*");

    // Store data pointer (field 0)
    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      dataFieldPtr +
        " = getelementptr inbounds %Uint8Array, %Uint8Array* " +
        structPtr +
        ", i32 0, i32 0",
    );
    this.ctx.emit("store i8* " + dataPtr + ", i8** " + dataFieldPtr);

    // Store length (field 1)
    const lenFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      lenFieldPtr +
        " = getelementptr inbounds %Uint8Array, %Uint8Array* " +
        structPtr +
        ", i32 0, i32 1",
    );
    this.ctx.emit("store i32 " + byteLenI32 + ", i32* " + lenFieldPtr);

    // Store capacity = length (field 2)
    const capFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      capFieldPtr +
        " = getelementptr inbounds %Uint8Array, %Uint8Array* " +
        structPtr +
        ", i32 0, i32 2",
    );
    this.ctx.emit("store i32 " + byteLenI32 + ", i32* " + capFieldPtr);

    this.ctx.setVariableType(structPtr, "%Uint8Array*");

    return structPtr;
  }

  generateLookupFunction(): string {
    if (this.embeddedKeys.length === 0) {
      return "";
    }

    const keyStrIds: string[] = [];
    const keyLens: number[] = [];
    for (let i = 0; i < this.embeddedKeys.length; i++) {
      this.createGlobalStringDirect(this.embeddedKeys[i]);
      keyStrIds.push(this._lastStrId);
      keyLens.push(this._lastLen);
    }
    this.createGlobalStringDirect("");
    const emptyStrId = this._lastStrId;
    const emptyLen = this._lastLen;

    let ir = "";
    ir += "define i8* @__cs_get_embedded_file(i8* %key) {\n";
    ir += "entry:\n";

    for (let i = 0; i < this.embeddedKeys.length; i++) {
      const contentStrId = this.embeddedStrIds[i];
      const contentStrLen = this.embeddedStrLens[i];

      ir +=
        "  %key_ptr_" +
        i +
        " = getelementptr inbounds [" +
        keyLens[i] +
        " x i8], [" +
        keyLens[i] +
        " x i8]* " +
        keyStrIds[i] +
        ", i64 0, i64 0\n";
      ir += "  %cmp_" + i + " = call i32 @strcmp(i8* %key, i8* %key_ptr_" + i + ")\n";
      ir += "  %is_" + i + " = icmp eq i32 %cmp_" + i + ", 0\n";
      const foundLabel = "found" + i;
      const nextLabel = i < this.embeddedKeys.length - 1 ? "check" + (i + 1) : "notfound";
      ir += "  br i1 %is_" + i + ", label %" + foundLabel + ", label %" + nextLabel + "\n";
      ir += foundLabel + ":\n";
      ir +=
        "  %content_ptr_" +
        i +
        " = getelementptr inbounds [" +
        contentStrLen +
        " x i8], [" +
        contentStrLen +
        " x i8]* " +
        contentStrId +
        ", i64 0, i64 0\n";
      ir += "  ret i8* %content_ptr_" + i + "\n";
      if (i < this.embeddedKeys.length - 1) {
        ir += "check" + (i + 1) + ":\n";
      }
    }

    ir += "notfound:\n";
    ir +=
      "  %empty_ptr = getelementptr inbounds [" +
      emptyLen +
      " x i8], [" +
      emptyLen +
      " x i8]* " +
      emptyStrId +
      ", i64 0, i64 0\n";
    ir += "  ret i8* %empty_ptr\n";
    ir += "}\n\n";

    return ir;
  }

  /** Generate @__cs_get_embedded_file_len — same strcmp chain as the content
   * lookup, but returns the byte length (i64) instead of a pointer.
   * Returns 0 for not-found. Lengths are known at compile time from Buffer.length. */
  generateLengthLookupFunction(): string {
    if (this.embeddedKeys.length === 0) {
      return "";
    }

    const keyStrIds: string[] = [];
    const keyLens: number[] = [];
    for (let i = 0; i < this.embeddedKeys.length; i++) {
      this.createGlobalStringDirect(this.embeddedKeys[i]);
      keyStrIds.push(this._lastStrId);
      keyLens.push(this._lastLen);
    }

    let ir = "";
    ir += "define i64 @__cs_get_embedded_file_len(i8* %key) {\n";
    ir += "entry:\n";

    for (let i = 0; i < this.embeddedKeys.length; i++) {
      ir +=
        "  %lkey_ptr_" +
        i +
        " = getelementptr inbounds [" +
        keyLens[i] +
        " x i8], [" +
        keyLens[i] +
        " x i8]* " +
        keyStrIds[i] +
        ", i64 0, i64 0\n";
      ir += "  %lcmp_" + i + " = call i32 @strcmp(i8* %key, i8* %lkey_ptr_" + i + ")\n";
      ir += "  %lis_" + i + " = icmp eq i32 %lcmp_" + i + ", 0\n";
      const foundLabel = "lfound" + i;
      const nextLabel = i < this.embeddedKeys.length - 1 ? "lcheck" + (i + 1) : "lnotfound";
      ir += "  br i1 %lis_" + i + ", label %" + foundLabel + ", label %" + nextLabel + "\n";
      ir += foundLabel + ":\n";
      ir += "  ret i64 " + this.embeddedByteLens[i] + "\n";
      if (i < this.embeddedKeys.length - 1) {
        ir += "lcheck" + (i + 1) + ":\n";
      }
    }

    ir += "lnotfound:\n";
    ir += "  ret i64 0\n";
    ir += "}\n\n";

    return ir;
  }
}
