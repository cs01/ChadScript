import * as fs from 'fs';
import * as nodePath from 'path';
import { MethodCallNode } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';

interface ExprBase { type: string; }

interface StringLiteralNode {
  type: 'string';
  value: string;
}

interface EmbeddedFile {
  key: string;
  contentPtr: string;
}

export class EmbedGenerator {
  private embeddedFiles: EmbeddedFile[] = [];
  private entryDir: string;

  constructor(private ctx: IGeneratorContext, filename: string) {
    this.entryDir = filename ? nodePath.dirname(nodePath.resolve(filename)) : process.cwd();
  }

  hasEmbeddedFiles(): boolean {
    return this.embeddedFiles.length > 0;
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
    const absPath = nodePath.resolve(this.entryDir, relPath);

    if (!fs.existsSync(absPath)) {
      return this.ctx.emitError(`ChadScript.embedFile(): file not found: ${absPath}`, expr.loc);
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const contentPtr = this.ctx.createStringConstant(content);
    this.ctx.setVariableType(contentPtr, 'i8*');

    const key = nodePath.basename(relPath);
    this.embeddedFiles.push({ key, contentPtr });

    return contentPtr;
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
    const absPath = nodePath.resolve(this.entryDir, relPath);

    if (!fs.existsSync(absPath)) {
      return this.ctx.emitError(`ChadScript.embedDir(): directory not found: ${absPath}`, expr.loc);
    }

    this.walkDir(absPath, absPath);

    return 'null';
  }

  private walkDir(dirPath: string, baseDir: string): void {
    const entries = fs.readdirSync(dirPath);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const fullPath = nodePath.join(dirPath, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        this.walkDir(fullPath, baseDir);
      } else {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const contentPtr = this.ctx.createStringConstant(content);
        this.ctx.setVariableType(contentPtr, 'i8*');
        const relKey = nodePath.relative(baseDir, fullPath);
        this.embeddedFiles.push({ key: relKey, contentPtr });
      }
    }
  }

  generateGetEmbeddedFile(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError('ChadScript.getEmbeddedFile() requires 1 argument (file key)', expr.loc);
    }

    const keyPtr = this.ctx.generateExpression(expr.args[0], params);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @__cs_get_embedded_file(i8* ${keyPtr})`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  generateLookupFunction(): string {
    if (this.embeddedFiles.length === 0) {
      return '';
    }

    let ir = '';
    ir += 'define i8* @__cs_get_embedded_file(i8* %key) {\n';
    ir += 'entry:\n';

    for (let i = 0; i < this.embeddedFiles.length; i++) {
      const file = this.embeddedFiles[i];
      const keyPtr = this.ctx.createStringConstant(file.key);
      const cmpReg = this.ctx.nextTemp();
      ir += `  ${cmpReg} = call i32 @strcmp(i8* %key, i8* ${keyPtr})\n`;
      const isEqReg = this.ctx.nextTemp();
      ir += `  ${isEqReg} = icmp eq i32 ${cmpReg}, 0\n`;
      const foundLabel = `found${i}`;
      const nextLabel = i < this.embeddedFiles.length - 1 ? `check${i + 1}` : 'notfound';
      ir += `  br i1 ${isEqReg}, label %${foundLabel}, label %${nextLabel}\n`;
      ir += `${foundLabel}:\n`;
      ir += `  ret i8* ${file.contentPtr}\n`;
      if (i < this.embeddedFiles.length - 1) {
        ir += `check${i + 1}:\n`;
      }
    }

    ir += 'notfound:\n';
    const emptyPtr = this.ctx.createStringConstant('');
    ir += `  ret i8* ${emptyPtr}\n`;
    ir += '}\n\n';

    return ir;
  }
}
