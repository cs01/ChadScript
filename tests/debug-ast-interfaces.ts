import { parseSourceWithTreeSitter } from '../src/parser-native/tree-sitter-parser.js';
import { transformTree } from '../src/parser-native/transformer.js';
import * as fs from 'fs';

const code = fs.readFileSync('./src/ast/types.ts', 'utf8');
const tree = parseSourceWithTreeSitter(code);
const ast = transformTree(tree);

console.log('Interfaces found in ast/types.ts:');
for (const iface of ast.interfaces) {
  console.log(' - ' + iface.name);
}
console.log('Total:', ast.interfaces.length);

// Check if AST interface has functions field
const astIface = ast.interfaces.find((i: any) => i.name === 'AST');
if (astIface) {
  console.log('\nAST interface fields:');
  for (const field of astIface.fields) {
    console.log(` - ${field.name}: ${field.type}`);
  }
}
