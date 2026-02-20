import { describe, it } from "node:test";
import assert from "node:assert";
import { LLVMGenerator } from "../../src/codegen/llvm-generator.js";
import type { AST, InterfaceDeclaration } from "../../src/ast/types.js";

function makeMinimalAST(interfaces: InterfaceDeclaration[]): AST {
  return {
    imports: [],
    functions: [],
    classes: [],
    exports: [],
    interfaces,
    typeAliases: [],
    enums: [],
    topLevelStatements: [],
    topLevelExpressions: [],
  };
}

function createGenerator(interfaces: InterfaceDeclaration[]): LLVMGenerator {
  const ast = makeMinimalAST(interfaces);
  return new LLVMGenerator(ast, null, { linkTreeSitter: false });
}

describe("getInterfaceProperties", () => {
  it("should return null for unknown interface", () => {
    const gen = createGenerator([]);
    const result = gen.getInterfaceProperties("NonExistent");
    assert.strictEqual(result, null);
  });

  it("should return matching keys and types for single-field interface", () => {
    const gen = createGenerator([{ name: "Point", fields: [{ name: "x", type: "number" }] }]);
    const result = gen.getInterfaceProperties("Point");
    assert.ok(result);
    assert.strictEqual(result.keys.length, result.types.length);
    assert.deepStrictEqual(result.keys, ["x"]);
    assert.deepStrictEqual(result.types, ["number"]);
  });

  it("should return matching keys and types for multi-field interface", () => {
    const gen = createGenerator([
      {
        name: "User",
        fields: [
          { name: "name", type: "string" },
          { name: "age", type: "number" },
          { name: "active", type: "boolean" },
        ],
      },
    ]);
    const result = gen.getInterfaceProperties("User");
    assert.ok(result);
    assert.strictEqual(result.keys.length, result.types.length);
    assert.strictEqual(result.keys.length, 3);
    assert.deepStrictEqual(result.keys, ["name", "age", "active"]);
    assert.deepStrictEqual(result.types, ["string", "number", "boolean"]);
  });

  it("should strip optional marker from field names", () => {
    const gen = createGenerator([
      {
        name: "Config",
        fields: [
          { name: "host", type: "string" },
          { name: "port?", type: "number" },
        ],
      },
    ]);
    const result = gen.getInterfaceProperties("Config");
    assert.ok(result);
    assert.strictEqual(result.keys.length, result.types.length);
    assert.deepStrictEqual(result.keys, ["host", "port"]);
    assert.deepStrictEqual(result.types, ["string", "number"]);
  });

  it("should strip optional marker from interface name", () => {
    const gen = createGenerator([{ name: "Item", fields: [{ name: "id", type: "number" }] }]);
    const result = gen.getInterfaceProperties("Item?");
    assert.ok(result);
    assert.strictEqual(result.keys.length, result.types.length);
    assert.deepStrictEqual(result.keys, ["id"]);
  });

  it("should handle union type name by taking first member", () => {
    const gen = createGenerator([
      {
        name: "Dog",
        fields: [
          { name: "breed", type: "string" },
          { name: "weight", type: "number" },
        ],
      },
    ]);
    const result = gen.getInterfaceProperties("Dog | Cat");
    assert.ok(result);
    assert.strictEqual(result.keys.length, result.types.length);
    assert.deepStrictEqual(result.keys, ["breed", "weight"]);
  });

  it("should return null for interface with empty fields", () => {
    const gen = createGenerator([{ name: "Empty", fields: [] }]);
    const result = gen.getInterfaceProperties("Empty");
    assert.strictEqual(result, null);
  });

  it("should select correct interface among multiple", () => {
    const gen = createGenerator([
      { name: "A", fields: [{ name: "a1", type: "string" }] },
      {
        name: "B",
        fields: [
          { name: "b1", type: "number" },
          { name: "b2", type: "boolean" },
        ],
      },
      {
        name: "C",
        fields: [
          { name: "c1", type: "string" },
          { name: "c2", type: "string" },
          { name: "c3", type: "number" },
        ],
      },
    ]);

    const resultA = gen.getInterfaceProperties("A");
    assert.ok(resultA);
    assert.strictEqual(resultA.keys.length, resultA.types.length);
    assert.strictEqual(resultA.keys.length, 1);

    const resultB = gen.getInterfaceProperties("B");
    assert.ok(resultB);
    assert.strictEqual(resultB.keys.length, resultB.types.length);
    assert.strictEqual(resultB.keys.length, 2);

    const resultC = gen.getInterfaceProperties("C");
    assert.ok(resultC);
    assert.strictEqual(resultC.keys.length, resultC.types.length);
    assert.strictEqual(resultC.keys.length, 3);
  });

  it("should return null when ast has no interfaces array", () => {
    const gen = createGenerator([]);
    gen.ast = { interfaces: null } as unknown as AST;
    const result = gen.getInterfaceProperties("Foo");
    assert.strictEqual(result, null);
  });

  it("should maintain keys.length === types.length with complex field types", () => {
    const gen = createGenerator([
      {
        name: "Complex",
        fields: [
          { name: "items", type: "string[]" },
          { name: "metadata", type: "Map<string, number>" },
          { name: "callback", type: "(x: number) => void" },
          { name: "nested", type: "OtherInterface" },
        ],
      },
    ]);
    const result = gen.getInterfaceProperties("Complex");
    assert.ok(result);
    assert.strictEqual(result.keys.length, result.types.length);
    assert.strictEqual(result.keys.length, 4);
  });
});
