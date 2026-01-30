import { Parser } from '../../src/parser/parser.js';
import { LLVMGenerator } from '../../src/codegen/llvm-generator.js';
import { TypeChecker } from '../../src/typescript/type-checker.js';
import { getLibrary } from '../../lib/index.js';

const code = `
import { ArgumentParser } from '../../lib/argparse.js';
const parser = new ArgumentParser('test', 'Test');
parser.addPositional('input', 'Input file');
parser.parse(process.argv);
console.log("length");
const direct = parser.parsedPositionals[0];
console.log(direct);
`;

const parser = new Parser(code, 'test');
const ast = parser.parse();
console.log('topLevelItems length:', ast.topLevelItems?.length);
if (ast.topLevelItems) {
  for (let i = 0; i < ast.topLevelItems.length; i++) {
    const item = ast.topLevelItems[i];
    console.log(i + ':', item.type, (item as any).name || (item as any).method || '');
  }
}
