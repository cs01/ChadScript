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
  private entryDir: string;
  private _lastStrId: string = "";
  private _lastLen: number = 0;

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

  private createGlobalStringDirect(value: string): void {
    const strId = this.ctx.nextString();
    const escaped = this.escapeForLLVM(value);
    const len = this.countUtf8Bytes(value) + 1;
    this.ctx.pushGlobalString(
      strId + " = private unnamed_addr constant [" + len + ' x i8] c"' + escaped + '\\00", align 1',
    );
    this._lastStrId = strId;
    this._lastLen = len;
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

    const content = fs.readFileSync(absPath, "utf-8");
    this.createGlobalStringDirect(content);
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
        const content = fs.readFileSync(fullPath, "utf-8");
        this.createGlobalStringDirect(content);
        const key = fullPath.substring(baseDir.length + 1);
        this.embeddedKeys.push(key);
        this.embeddedStrIds.push(this._lastStrId);
        this.embeddedStrLens.push(this._lastLen);
      }
    }
  }

  /**
   * ChadScript.serveEmbedded(path) — returns an HttpResponse struct pointer.
   * Strips leading "/" from path, looks up the embedded file, and returns
   * { 200.0, content, "" } if found, or { 404.0, "Not Found", "" } if not.
   */
  generateServeEmbedded(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("ChadScript.serveEmbedded() requires 1 argument (path)", expr.loc);
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    // Strip leading "/" from path: if path[0] == '/', advance by 1
    const firstChar = this.ctx.nextTemp();
    this.ctx.emit(firstChar + " = load i8, i8* " + pathPtr);
    const isSlash = this.ctx.nextTemp();
    this.ctx.emit(isSlash + " = icmp eq i8 " + firstChar + ", 47"); // '/' = 47
    const stripped = this.ctx.nextTemp();
    const onePtr = this.ctx.nextTemp();
    this.ctx.emit(onePtr + " = getelementptr i8, i8* " + pathPtr + ", i64 1");
    this.ctx.emit(stripped + " = select i1 " + isSlash + ", i8* " + onePtr + ", i8* " + pathPtr);

    // Look up the embedded file
    const content = this.ctx.nextTemp();
    this.ctx.emit(content + " = call i8* @__cs_get_embedded_file(i8* " + stripped + ")");

    // Check if found (strlen > 0)
    const contentLen = this.ctx.nextTemp();
    this.ctx.emit(contentLen + " = call i64 @strlen(i8* " + content + ")");
    const found = this.ctx.nextTemp();
    this.ctx.emit(found + " = icmp ugt i64 " + contentLen + ", 0");

    const foundLabel = this.ctx.nextLabel("serve_found");
    const notFoundLabel = this.ctx.nextLabel("serve_notfound");
    const joinLabel = this.ctx.nextLabel("serve_join");

    this.ctx.emit("br i1 " + found + ", label %" + foundLabel + ", label %" + notFoundLabel);

    // Found: allocate { 200.0, content, "" }
    this.ctx.emit(foundLabel + ":");
    const foundStruct = this.ctx.nextTemp();
    this.ctx.emit(foundStruct + " = call i8* @GC_malloc(i64 24)");
    const foundTyped = this.ctx.nextTemp();
    this.ctx.emit(foundTyped + " = bitcast i8* " + foundStruct + " to { double, i8*, i8* }*");
    const fStatusPtr = this.ctx.nextTemp();
    this.ctx.emit(
      fStatusPtr +
        " = getelementptr { double, i8*, i8* }, { double, i8*, i8* }* " +
        foundTyped +
        ", i32 0, i32 0",
    );
    this.ctx.emit("store double 200.0, double* " + fStatusPtr);
    const fBodyPtr = this.ctx.nextTemp();
    this.ctx.emit(
      fBodyPtr +
        " = getelementptr { double, i8*, i8* }, { double, i8*, i8* }* " +
        foundTyped +
        ", i32 0, i32 1",
    );
    this.ctx.emit("store i8* " + content + ", i8** " + fBodyPtr);
    // Empty headers string
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
        " = getelementptr { double, i8*, i8* }, { double, i8*, i8* }* " +
        foundTyped +
        ", i32 0, i32 2",
    );
    this.ctx.emit("store i8* " + emptyStr + ", i8** " + fHdrsPtr);
    this.ctx.emit("br label %" + joinLabel);

    // Not found: allocate { 404.0, "Not Found", "" }
    this.ctx.emit(notFoundLabel + ":");
    const nfStruct = this.ctx.nextTemp();
    this.ctx.emit(nfStruct + " = call i8* @GC_malloc(i64 24)");
    const nfTyped = this.ctx.nextTemp();
    this.ctx.emit(nfTyped + " = bitcast i8* " + nfStruct + " to { double, i8*, i8* }*");
    const nfStatusPtr = this.ctx.nextTemp();
    this.ctx.emit(
      nfStatusPtr +
        " = getelementptr { double, i8*, i8* }, { double, i8*, i8* }* " +
        nfTyped +
        ", i32 0, i32 0",
    );
    this.ctx.emit("store double 404.0, double* " + nfStatusPtr);
    // Create "Not Found" string constant
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
        " = getelementptr { double, i8*, i8* }, { double, i8*, i8* }* " +
        nfTyped +
        ", i32 0, i32 1",
    );
    this.ctx.emit("store i8* " + nfBodyStr + ", i8** " + nfBodyPtr);
    // Reuse same empty string global
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
        " = getelementptr { double, i8*, i8* }, { double, i8*, i8* }* " +
        nfTyped +
        ", i32 0, i32 2",
    );
    this.ctx.emit("store i8* " + emptyStr2 + ", i8** " + nfHdrsPtr);
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
}
