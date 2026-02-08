import { parseWithTSAPI } from '../../src/parser-ts/index.js';

const source = `let i = 0;
i++;
console.log("i = " + i);`;

const ast = parseWithTSAPI(source, { filename: 'test.ts' });

console.log("topLevelItems:", ast.topLevelItems?.length);
for (let i = 0; i < (ast.topLevelItems?.length || 0); i++) {
  const item = ast.topLevelItems![i];
  console.log(`  [${i}] type:`, item.type);
}
