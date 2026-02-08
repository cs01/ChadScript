import { parseSource } from '../../src/parser-native/index.js';
import { transformTree } from '../../src/parser-native/transformer.js';

declare const fs: {
  readFileSync(filename: string): string;
};

const code = 'class Foo {\n  value: number;\n  constructor(v: number) {\n    this.value = v;\n  }\n}';
console.log("Code:");
console.log(code);
console.log("---");

const tree = parseSource(code);
const ast = transformTree(tree);

console.log("Classes count: " + ast.classes.length);
const cls = ast.classes[0];
console.log("Class name: " + cls.name);
console.log("Fields count: " + cls.fields.length);
console.log("Constructor: " + (cls.constructor !== null ? "exists" : "null"));
if (cls.constructor !== null) {
  const ctor = cls.constructor;
  console.log("Ctor body length: " + ctor.body.length);
  if (ctor.body.length > 0) {
    const stmt = ctor.body[0];
    console.log("First stmt type: " + stmt.type);
    if (stmt.type === "assignment") {
      const asgn = stmt;
      console.log("Assignment value type: " + asgn.value.type);
    }
  }
}
