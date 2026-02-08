import * as fs from 'fs';
import { parseWithTSAPI } from '../../src/parser-ts/index.js';
import { LLVMGenerator } from '../../src/codegen/llvm-generator.js';

const source = fs.readFileSync('src/native-compiler.ts', 'utf-8');
const ast = parseWithTSAPI(source, { filename: 'native-compiler.ts' });

try {
  const gen = new LLVMGenerator(ast, null, { linkTreeSitter: true, skipSemanticAnalysis: true });
  gen.generate();
} catch (e: any) {
  console.error(e.stack);
}
