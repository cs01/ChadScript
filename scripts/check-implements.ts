import { parseWithTSAPI } from '../src/parser-ts/index.js';
import * as fs from 'fs';

const source = fs.readFileSync('src/codegen/llvm-generator.ts', 'utf-8');
const ast = parseWithTSAPI(source);
console.log('Classes found: ' + ast.classes.length);
for (const cls of ast.classes) {
  console.log(cls.name + ': implements=' + JSON.stringify(cls.implements));
  console.log('  Fields: ' + cls.fields.map(f => f.name).join(', '));
  for (const field of cls.fields) {
    if (field.name === 'classGen') {
      console.log('  classGen field: ' + JSON.stringify(field));
    }
  }
}
