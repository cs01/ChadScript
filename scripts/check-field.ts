import ts from 'typescript';
import { TypeScriptParser } from '../src/parser/typescript-parser.js';
import { readFileSync } from 'fs';

const source = readFileSync('./src/codegen/llvm-generator.ts', 'utf-8');
const parser = new TypeScriptParser();
const ast = parser.parse(source);

for (const cls of ast.classes) {
  if (cls.name === 'LLVMGenerator') {
    for (const field of cls.fields) {
      if (field.name === 'classGen') {
        console.log('Field found:', JSON.stringify(field, null, 2));
      }
    }
  }
}
