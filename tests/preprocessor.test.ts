import { preprocess, hasGenerators } from '../src/preprocessor/index.js';

const generatorCode = `
function* range(start: number, end: number): Generator<number> {
  for (let i = start; i < end; i++) {
    yield i;
  }
}

const nums = [...range(0, 5)];
console.log(nums);
`;

const nonGeneratorCode = `
function add(a: number, b: number): number {
  return a + b;
}
`;

console.log('=== Testing hasGenerators ===');
console.log('Generator code has generators:', hasGenerators(generatorCode));
console.log('Non-generator code has generators:', hasGenerators(nonGeneratorCode));

console.log('\n=== Original generator code ===');
console.log(generatorCode);

console.log('\n=== Transpiled generator code ===');
const transpiled = preprocess(generatorCode, 'test.ts');
console.log(transpiled);

console.log('\n=== Verify transpiled has no generators ===');
console.log('Transpiled has generators:', hasGenerators(transpiled));
