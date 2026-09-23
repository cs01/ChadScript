// verifyHir proves the "every HIR node is typed before codegen" invariant. These mutation-style
// tests construct malformed HIR directly (bypassing the type system, as a lowering bug would) and
// assert verifyHir rejects it — so a typeless node fails loudly at the gate, not as garbage IR.

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyHir } from "../../src/hir/verify.js";
import type { HModule, HExpr, HStmt } from "../../src/hir/nodes.js";
import type { ValueType } from "../../src/hir/types.js";

const numType = { kind: "number" } as const;
const num = (v: number): HExpr => ({ kind: "numberLit", value: v, type: numType });
const mod = (topLevel: HStmt[]): HModule => ({ functions: [], topLevel, shapes: [] });

test("accepts a well-formed module", () => {
  const m = mod([{ kind: "consoleLog", values: [num(1), num(2)] }]);
  assert.doesNotThrow(() => verifyHir(m));
});

test("rejects an expression with no resolved type", () => {
  const typeless = { kind: "numberLit", value: 1 } as unknown as HExpr; // missing `type`
  const m = mod([{ kind: "consoleLog", values: [typeless] }]);
  assert.throws(() => verifyHir(m), /no resolved type/);
});

test("rejects a typeless node nested deep in the tree", () => {
  const badLeft = { kind: "varRef", name: "x" } as unknown as HExpr; // missing `type`
  const bin: HExpr = { kind: "binary", op: "add", left: badLeft, right: num(2), type: numType };
  const m = mod([{ kind: "return", value: bin }]);
  assert.throws(() => verifyHir(m), /no resolved type/);
});

test("rejects a type field that is not a ValueType", () => {
  const bad = { kind: "numberLit", value: 1, type: "number" } as unknown as HExpr; // string, not {kind}
  const m = mod([{ kind: "exprStmt", expr: bad }]);
  assert.throws(() => verifyHir(m), /no resolved type/);
});

test("traverses function bodies, not just top-level", () => {
  const typeless = { kind: "boolLit", value: true } as unknown as HExpr;
  const m: HModule = {
    functions: [
      { name: "f", params: [], returnType: null, body: [{ kind: "exprStmt", expr: typeless }] },
    ],
    topLevel: [],
    shapes: [],
  };
  assert.throws(() => verifyHir(m), /no resolved type/);
});

const objType: ValueType = { kind: "object", shape: { fields: [{ name: "x", type: numType }] } };
const shapeX = { id: 0, fields: [{ name: "x", type: numType }], methods: [] };
const withShape = (e: HExpr): HModule => ({
  functions: [],
  topLevel: [{ kind: "exprStmt", expr: e }],
  shapes: [shapeX],
});

test("rejects an object literal whose field count disagrees with its shape", () => {
  const lit: HExpr = { kind: "objectLit", shape: 0, fields: [num(1), num(2)], type: objType };
  assert.throws(() => verifyHir(withShape(lit)), /shape 0 has 1/);
});

test("rejects a member access with neither a valid slot nor an inline-cache site", () => {
  const lit: HExpr = { kind: "objectLit", shape: 0, fields: [num(1)], type: objType };
  const get: HExpr = {
    kind: "memberGet",
    object: lit,
    access: { kind: "slot", index: -1 },
    type: numType,
  };
  assert.throws(() => verifyHir(withShape(get)), /bad field index/);
});

// Value unions: every representation change is an explicit box/unbox, checked at both ends.
const numOrStr: ValueType = { kind: "value", members: [numType, { kind: "string" }] };

test("accepts a boxed number stored in a Value-union variable and unboxed back", () => {
  const boxed: HExpr = { kind: "box", value: num(1), type: numOrStr };
  const read: HExpr = {
    kind: "unbox",
    value: { kind: "varRef", name: "x", type: numOrStr },
    type: numType,
  };
  const m = mod([
    { kind: "varDecl", name: "x", init: boxed, type: numOrStr },
    { kind: "consoleLog", values: [read] },
  ]);
  assert.doesNotThrow(() => verifyHir(m));
});

test("rejects a concrete value stored into a Value slot without a box", () => {
  const m = mod([{ kind: "varDecl", name: "x", init: num(1), type: numOrStr }]);
  assert.throws(() => verifyHir(m), /without box\/unbox/);
});

test("rejects a box whose source is already a Value, or whose target is not one", () => {
  const v: HExpr = { kind: "varRef", name: "x", type: numOrStr };
  const reboxed: HExpr = { kind: "box", value: v, type: numOrStr };
  assert.throws(() => verifyHir(mod([{ kind: "exprStmt", expr: reboxed }])), /box from value/);
  const notValue: HExpr = { kind: "box", value: num(1), type: numType };
  assert.throws(() => verifyHir(mod([{ kind: "exprStmt", expr: notValue }])), /box from number/);
});

test("rejects an unbox to a kind the union never holds", () => {
  const v: HExpr = { kind: "varRef", name: "x", type: numOrStr };
  const bad: HExpr = { kind: "unbox", value: v, type: { kind: "boolean" } };
  assert.throws(
    () => verifyHir(mod([{ kind: "exprStmt", expr: bad }])),
    /which the union never holds/,
  );
});
