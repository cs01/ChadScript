import { parseSource, getNamedChild, getChildByFieldName, getChild } from '../../src/parser-native/index.js';
import { transformTree } from '../../src/parser-native/transformer.js';

const source = `
let sum = 0;
let i = 0;
while (i < 5) {
  sum = sum + i;
  i = i + 1;
}
console.log(sum);
`;

const tree = parseSource(source);
const root = tree.rootNode;

console.log('Root type:', root.type);
console.log('Root child count:', root.namedChildCount);

for (let i = 0; i < root.namedChildCount; i++) {
  const child = getNamedChild(root, i);
  if (child) {
    console.log('\nChild ' + i + ': ' + child.type);
    console.log('  Text:', child.text.slice(0, 50));
    
    if (child.type === 'while_statement') {
      const body = getChildByFieldName(child, 'body');
      if (body) {
        console.log('  Body type:', body.type);
        for (let j = 0; j < body.namedChildCount; j++) {
          const stmt = getNamedChild(body, j);
          if (stmt) {
            console.log('    Stmt ' + j + ': ' + stmt.type);
            if (stmt.type === 'expression_statement') {
              const expr = getNamedChild(stmt, 0);
              if (expr) {
                console.log('      Expr: ' + expr.type);
                if (expr.type === 'assignment_expression') {
                  const left = getNamedChild(expr, 0);
                  const right = getNamedChild(expr, 1);
                  console.log('        Left (child 0): ' + left?.type + ' = "' + left?.text + '"');
                  console.log('        Right (child 1): ' + right?.type + ' = "' + right?.text + '"');
                }
              }
            }
          }
        }
      }
    }
  }
}

const ast = transformTree(tree);
console.log('\nTransformed AST topLevelExpressions count:', ast.topLevelExpressions.length);
for (let i = 0; i < ast.topLevelExpressions.length; i++) {
  const expr = ast.topLevelExpressions[i];
  const exprTyped = expr as { type: string; condition?: unknown; body?: unknown };
  console.log('\nItem ' + i + ' type:', exprTyped.type);
  if (exprTyped.type === 'while') {
    const body = exprTyped.body as { statements: unknown[] };
    console.log('  Body statements:', body.statements.length);
    for (let j = 0; j < body.statements.length; j++) {
      const stmt = body.statements[j] as { type: string; name?: string; value?: unknown };
      console.log('    Stmt ' + j + ':', stmt.type, stmt.name || '');
      if (stmt.value) {
        console.log('      Value:', JSON.stringify(stmt.value, null, 2).slice(0, 200));
      }
    }
  }
}
