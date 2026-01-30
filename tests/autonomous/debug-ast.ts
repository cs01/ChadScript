import { Parser } from '../../src/parser/parser.js';

const code = `
const parser = new ArgumentParser('test', 'Test');
parser.addPositional('input', 'Input file');
parser.parse(process.argv);
console.log("length: " + parser.parsedPositionals.length);
const direct = parser.parsedPositionals[0];
console.log(direct);
`;

const parser = new Parser(code, 'test');
const ast = parser.parse();
console.log('topLevelItems:', ast.topLevelItems?.length);
for (let i = 0; i < (ast.topLevelItems?.length || 0); i++) {
  const item = (ast.topLevelItems as any)[i];
  console.log(i + ':', item.type, item.name || item.method || '');
}
