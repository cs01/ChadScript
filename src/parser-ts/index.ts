import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { AST } from '../ast/types.js';
import { transformSourceFile } from './transformer.js';

export interface ParseOptions {
  filename?: string;
}

export function parseWithTSAPI(code: string, options: ParseOptions = {}): AST {
  const filename = options.filename || 'input.ts';

  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  return transformSourceFile(sourceFile, undefined);
}

export function parseFileWithTSAPI(filepath: string): AST {
  const absolutePath = path.resolve(filepath);
  const code = fs.readFileSync(absolutePath, 'utf-8');

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(compilerOptions);
  const program = ts.createProgram([absolutePath], compilerOptions, host);
  const sourceFile = program.getSourceFile(absolutePath);

  if (!sourceFile) {
    throw new Error(`Failed to parse file: ${filepath}`);
  }

  const checker = program.getTypeChecker();

  return transformSourceFile(sourceFile, checker);
}
