import { parseSource } from '../../src/parser-native/index.js';
import { transformTree } from '../../src/parser-native/transformer.js';
import { LLVMGenerator, LLVMGeneratorOptions } from '../../src/codegen/llvm-generator.js';

declare const fs: {
  readFileSync(filename: string): string;
};

console.log('Parsing file...');
const code = fs.readFileSync('./tests/fixtures/arithmetic/simple-add.js');
console.log('Code read, length = ' + code.length);
const tree = parseSource(code);
console.log('Parsed, transforming...');
const ast = transformTree(tree);
console.log('Transformed, creating generator...');
const options: LLVMGeneratorOptions = {
  linkTreeSitter: false,
  sourceCode: code,
  filename: 'test'
};
console.log('About to construct LLVMGenerator...');
const generator = new LLVMGenerator(ast, null, options);
console.log('LLVMGenerator constructed!');
console.log('Calling generate()...');
const ir = generator.generate();
console.log('IR length: ' + ir.length);
