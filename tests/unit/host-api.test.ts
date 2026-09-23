// The host API tables in src/lower/host-api.ts must list exactly the members stdlib/globals.d.ts
// declares on the host types and network modules: a declared member without a lowering would
// reach an ice(), and a lowering without a declaration is dead surface nobody tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { HOST_TYPES, isBrandMember } from "../../src/lower/host-types.js";
import { HOST_FUNCTIONS, HOST_METHODS, HOST_PROPERTIES } from "../../src/lower/host-api.js";

const here = dirname(fileURLToPath(import.meta.url));
const globalsPath = join(here, "..", "..", "stdlib", "globals.d.ts");
const sf = ts.createSourceFile(
  globalsPath,
  readFileSync(globalsPath, "utf8"),
  ts.ScriptTarget.ES2022,
  true,
);

// Modules whose exported functions are host functions (lowered by host-api.ts).
const HOST_MODULES = new Set(["net"]);

interface Declared {
  methods: Set<string>;
  properties: Set<string>;
  functions: Set<string>;
}

function collect(): Declared {
  const out: Declared = { methods: new Set(), properties: new Set(), functions: new Set() };
  const visitInterface = (iface: ts.InterfaceDeclaration, prefix: string): void => {
    const q = prefix + iface.name.text;
    if (!HOST_TYPES.has(q)) return;
    for (const m of iface.members) {
      const name = m.name && ts.isIdentifier(m.name) ? m.name.text : null;
      if (name === null || isBrandMember(name)) continue;
      if (ts.isMethodSignature(m)) out.methods.add(`${q}.${name}`);
      else if (ts.isPropertySignature(m)) out.properties.add(`${q}.${name}`);
    }
  };
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt)) visitInterface(stmt, "");
    if (ts.isModuleDeclaration(stmt) && ts.isStringLiteral(stmt.name)) {
      const mod = stmt.name.text.replace(/^node:/, "");
      const body = stmt.body;
      if (!body || !ts.isModuleBlock(body)) continue;
      for (const s of body.statements) {
        if (ts.isInterfaceDeclaration(s)) visitInterface(s, `${mod}.`);
        if (ts.isFunctionDeclaration(s) && s.name && HOST_MODULES.has(mod)) {
          out.functions.add(`${mod}.${s.name.text}`);
        }
      }
    }
  }
  return out;
}

const declared = collect();

test("every declared host method has a lowering, and every lowering a declaration", () => {
  assert.deepEqual([...declared.methods].sort(), Object.keys(HOST_METHODS).sort());
});

test("every declared host property has a lowering, and every lowering a declaration", () => {
  assert.deepEqual([...declared.properties].sort(), Object.keys(HOST_PROPERTIES).sort());
});

test("every declared host function has a lowering, and every lowering a declaration", () => {
  assert.deepEqual([...declared.functions].sort(), Object.keys(HOST_FUNCTIONS).sort());
});

test("every host type is declared", () => {
  const found = new Set<string>();
  for (const k of [...declared.methods, ...declared.properties]) {
    found.add(k.slice(0, k.lastIndexOf(".")));
  }
  assert.deepEqual([...found].sort(), [...HOST_TYPES].sort());
});
