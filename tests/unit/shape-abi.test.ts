// The object layouts generated IR reads directly are specified twice: as extern structs and
// constants in runtime/abi.milo (what the runtime reads) and as codegen's view in
// src/codegen/shapes.ts + src/codegen/value.ts (what generated code reads and writes). A drift
// between them is a silent miscompile, so this pins one against the other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SHAPE_FIELDS, KIND_CODE } from "../../src/codegen/shapes.js";
import { TAG, V_UNDEFINED, V_NULL, V_FALSE, V_TRUE } from "../../src/codegen/value.js";

const abi = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime", "abi.milo"),
  "utf8",
);

function structFields(name: string): string[] {
  const m = new RegExp(`extern struct ${name} \\{([^}]*)\\}`).exec(abi);
  assert.ok(m, `runtime/abi.milo has no extern struct ${name}`);
  return [...m[1]!.matchAll(/^\s*(\w+):/gm)].map((f) => f[1]!);
}

function constant(name: string): number {
  const m = new RegExp(`pub let ${name}: \\w+ = (0x[0-9a-fA-F]+|\\d+)`).exec(abi);
  assert.ok(m, `runtime/abi.milo has no constant ${name}`);
  return Number(m[1]);
}

test("CsShape field order matches codegen's shape layout", () => {
  assert.deepEqual(structFields("CsShape"), [...SHAPE_FIELDS]);
});

test("Value immediates and pointer tags match", () => {
  assert.equal(constant("VALUE_UNDEFINED"), V_UNDEFINED);
  assert.equal(constant("VALUE_NULL"), V_NULL);
  assert.equal(constant("VALUE_FALSE"), V_FALSE);
  assert.equal(constant("VALUE_TRUE"), V_TRUE);
  assert.equal(constant("VALUE_DOUBLE_OFFSET"), 2 ** 49);
  for (const [kind, tag] of Object.entries(TAG)) {
    assert.equal(constant(`TAG_${kind.toUpperCase()}`), tag, `tag ${kind}`);
  }
});

test("shape kind codes match", () => {
  for (const [kind, code] of Object.entries(KIND_CODE)) {
    assert.equal(constant(`KIND_${kind.toUpperCase()}`), code, `kind ${kind}`);
  }
});
