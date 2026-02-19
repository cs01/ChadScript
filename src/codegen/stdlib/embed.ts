import * as fs from 'fs';
import * as path from 'path';
import { MethodCallNode } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';

interface ExprBase { type: string; }

interface StringLiteralNode {
  type: 'string';
  value: string;
}

interface EmbeddedFile {
  key: string;
  globalStrId: string;
  globalStrLen: number;
}

export class EmbedGenerator {
  private embeddedFiles: EmbeddedFile[] = [];
  private entryDir: string;
  private _lastStrId: string = '';
  private _lastLen: number = 0;

  constructor(private ctx: IGeneratorContext, filename: string) {
    this.entryDir = filename ? path.dirname(path.resolve(filename)) : process.cwd();
  }

  hasEmbeddedFiles(): boolean {
    return this.embeddedFiles.length > 0;
  }

  private escapeForLLVM(value: string): string {
    let escaped = '';
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      const code = value.charCodeAt(i);
      if (ch === '\\') {
        escaped += '\\5C';
      } else if (ch === '\n') {
        escaped += '\\0A';
      } else if (ch === '\r') {
        escaped += '\\0D';
      } else if (ch === '\t') {
        escaped += '\\09';
      } else if (ch === '"') {
        escaped += '\\22';
      } else if (code < 32 || code > 126) {
        if (code < 128) {
          escaped += '\\' + this.byteToHex(code);
        } else if (code < 0x800) {
          escaped += '\\' + this.byteToHex(0xC0 | (code >> 6));
          escaped += '\\' + this.byteToHex(0x80 | (code & 0x3F));
        } else {
          escaped += '\\' + this.byteToHex(0xE0 | (code >> 12));
          escaped += '\\' + this.byteToHex(0x80 | ((code >> 6) & 0x3F));
          escaped += '\\' + this.byteToHex(0x80 | (code & 0x3F));
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
    const hexChars = '0123456789ABCDEF';
    const hi = hexChars.charAt((b >> 4) & 0xF);
    const lo = hexChars.charAt(b & 0xF);
    return hi + lo;
  }

  private createGlobalStringDirect(value: string): void {
    const strId = this.ctx.nextString();
    const escaped = this.escapeForLLVM(value);
    const len = this.countUtf8Bytes(value) + 1;
    this.ctx.pushGlobalString(strId + ' = private unnamed_addr constant [' + len + ' x i8] c"' + escaped + '\\00", align 1');
    this._lastStrId = strId;
    this._lastLen = len;
  }

  generateEmbedFile(expr: MethodCallNode, _params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError('ChadScript.embedFile() requires 1 argument (file path)', expr.loc);
    }

    const argBase = expr.args[0] as ExprBase;
    if (argBase.type !== 'string') {
      return this.ctx.emitError('ChadScript.embedFile() argument must be a string literal', expr.loc);
    }

    const relPath = (expr.args[0] as StringLiteralNode).value;
    const absPath = path.resolve(this.entryDir, relPath);

    if (!fs.existsSync(absPath)) {
      return this.ctx.emitError('ChadScript.embedFile(): file not found: ' + absPath, expr.loc);
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    this.createGlobalStringDirect(content);
    const strId = this._lastStrId;
    const len = this._lastLen;

    const ptrReg = this.ctx.nextTemp();
    this.ctx.emit(ptrReg + ' = getelementptr inbounds [' + len + ' x i8], [' + len + ' x i8]* ' + strId + ', i64 0, i64 0');
    this.ctx.setVariableType(ptrReg, 'i8*');

    const key = path.basename(relPath);
    this.embeddedFiles.push({ key, globalStrId: strId, globalStrLen: len });

    return ptrReg;
  }

  generateEmbedDir(expr: MethodCallNode, _params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError('ChadScript.embedDir() requires 1 argument (directory path)', expr.loc);
    }

    const argBase = expr.args[0] as ExprBase;
    if (argBase.type !== 'string') {
      return this.ctx.emitError('ChadScript.embedDir() argument must be a string literal', expr.loc);
    }

    const relPath = (expr.args[0] as StringLiteralNode).value;
    const absPath = path.resolve(this.entryDir, relPath);

    if (!fs.existsSync(absPath)) {
      return this.ctx.emitError('ChadScript.embedDir(): directory not found: ' + absPath, expr.loc);
    }

    this.walkDir(absPath, absPath);

    return 'null';
  }

  private walkDir(dirPath: string, baseDir: string): void {
    const entries = fs.readdirSync(dirPath);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const fullPath = path.join(dirPath, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        this.walkDir(fullPath, baseDir);
      } else {
        const content = fs.readFileSync(fullPath, 'utf-8');
        this.createGlobalStringDirect(content);
        const key = fullPath.substring(baseDir.length + 1);
        this.embeddedFiles.push({ key, globalStrId: this._lastStrId, globalStrLen: this._lastLen });
      }
    }
  }

  generateGetEmbeddedFile(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError('ChadScript.getEmbeddedFile() requires 1 argument (file key)', expr.loc);
    }

    const keyPtr = this.ctx.generateExpression(expr.args[0], params);

    const result = this.ctx.nextTemp();
    this.ctx.emit(result + ' = call i8* @__cs_get_embedded_file(i8* ' + keyPtr + ')');
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  generateLookupFunction(): string {
    if (this.embeddedFiles.length === 0) {
      return '';
    }

    const keyStrIds: string[] = [];
    const keyLens: number[] = [];
    for (let i = 0; i < this.embeddedFiles.length; i++) {
      this.createGlobalStringDirect(this.embeddedFiles[i].key);
      keyStrIds.push(this._lastStrId);
      keyLens.push(this._lastLen);
    }
    this.createGlobalStringDirect('');
    const emptyStrId = this._lastStrId;
    const emptyLen = this._lastLen;

    let ir = '';
    ir += 'define i8* @__cs_get_embedded_file(i8* %key) {\n';
    ir += 'entry:\n';

    for (let i = 0; i < this.embeddedFiles.length; i++) {
      const file = this.embeddedFiles[i];

      ir += '  %key_ptr_' + i + ' = getelementptr inbounds [' + keyLens[i] + ' x i8], [' + keyLens[i] + ' x i8]* ' + keyStrIds[i] + ', i64 0, i64 0\n';
      ir += '  %cmp_' + i + ' = call i32 @strcmp(i8* %key, i8* %key_ptr_' + i + ')\n';
      ir += '  %is_' + i + ' = icmp eq i32 %cmp_' + i + ', 0\n';
      const foundLabel = 'found' + i;
      const nextLabel = i < this.embeddedFiles.length - 1 ? 'check' + (i + 1) : 'notfound';
      ir += '  br i1 %is_' + i + ', label %' + foundLabel + ', label %' + nextLabel + '\n';
      ir += foundLabel + ':\n';
      ir += '  %content_ptr_' + i + ' = getelementptr inbounds [' + file.globalStrLen + ' x i8], [' + file.globalStrLen + ' x i8]* ' + file.globalStrId + ', i64 0, i64 0\n';
      ir += '  ret i8* %content_ptr_' + i + '\n';
      if (i < this.embeddedFiles.length - 1) {
        ir += 'check' + (i + 1) + ':\n';
      }
    }

    ir += 'notfound:\n';
    ir += '  %empty_ptr = getelementptr inbounds [' + emptyLen + ' x i8], [' + emptyLen + ' x i8]* ' + emptyStrId + ', i64 0, i64 0\n';
    ir += '  ret i8* %empty_ptr\n';
    ir += '}\n\n';

    return ir;
  }
}
