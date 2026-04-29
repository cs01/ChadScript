import { Parser, Language } from "web-tree-sitter";
import { resolve } from "path";

async function main() {
  await Parser.init();
  const lang = await Language.load(resolve("node_modules/tree-sitter-php/tree-sitter-php.wasm"));
  const parser = new Parser();
  parser.setLanguage(lang);

  const source = `<?php
function fib(int \$n): int {
    if (\$n <= 1) {
        return \$n;
    }
    return fib(\$n - 1) + fib(\$n - 2);
}

\$x = 10;
echo fib(\$x) . "\\n";
echo "hello world\\n";

\$y = 3 + 4 * 2;
echo \$y . "\\n";

function add(int \$a, int \$b): int {
    return \$a + \$b;
}

for (\$i = 0; \$i < 10; \$i++) {
    \$x = \$x + 1;
}
echo \$x . "\\n";

if (\$x > 15) {
    echo "big\\n";
} elseif (\$x > 10) {
    echo "medium\\n";
} else {
    echo "small\\n";
}
`;

  const tree = parser.parse(source);

  function dump(node: any, depth = 0) {
    const text = node.childCount === 0 ? ` "${node.text}"` : "";
    const fields: string[] = [];
    if (node.parent) {
      for (let i = 0; i < node.parent.childCount; i++) {
        const fn = node.parent.fieldNameForChild(i);
        if (fn && node.parent.child(i)?.id === node.id) {
          fields.push(fn);
        }
      }
    }
    const fieldStr = fields.length > 0 ? ` [${fields.join(",")}]` : "";
    console.log(`${"  ".repeat(depth)}${node.type}${fieldStr}${text}`);
    for (let i = 0; i < node.childCount; i++) {
      dump(node.child(i), depth + 1);
    }
  }

  dump(tree.rootNode);
}
main();
