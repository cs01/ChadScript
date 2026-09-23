// Program generator for the console.log / util.inspect fuzzer (tests/slow/inspect-fuzz.test.ts).
// Builds random nested values (arrays, object literals, class instances, Maps, Sets, optional and
// union elements, strings of every length and quoting situation, occasional cycles) and prints them
// with console.log, so Node's layout rules (line breaking at 80 columns, numeric column grouping,
// depth cutoffs, `... N more items`, string splitting and quoting) are diffed against the native
// runtime's port. Some lines go through util.format: a format string (a literal, or a string only
// known at run time) with %s %d %i %f %j %o %O %c %% and stray `%` pieces, applied to the same
// values. Every program is tsc-clean and deterministic.

import { makeRng } from "./fuzz-gen.js";

type Ty =
  | { k: "number" }
  | { k: "string" }
  | { k: "boolean" }
  | { k: "optnum" }
  | { k: "numstr" }
  | { k: "array"; el: Ty }
  | { k: "obj"; name: string; fields: [string, Ty][]; cls: boolean }
  | { k: "map"; key: "string" | "number"; val: Ty }
  | { k: "set"; el: "string" | "number" };

const KEY_NAMES = ["a", "b", "id", "name", "value", "x", "y", "longPropertyName", "_u", "k2"];
const WORDS = ["", "a", "hi", "hello", "abc def", "it's", 'say "x"', "tab\there", "x`y", "${z}"];

export function genInspectProgram(seed: number): string {
  const rng = makeRng(seed * 7919 + 13);
  const int = (n: number): number => Math.floor(rng() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const decls: string[] = [];
  const body: string[] = [];
  let objCount = 0;
  let tmp = 0;

  const tsType = (t: Ty): string => {
    switch (t.k) {
      case "number":
      case "string":
      case "boolean":
        return t.k;
      case "optnum":
        return "(number | undefined)";
      case "numstr":
        return "(number | string)";
      case "array":
        return `${tsType(t.el)}[]`;
      case "obj":
        return t.name;
      case "map":
        return `Map<${t.key}, ${tsType(t.val)}>`;
      case "set":
        return `Set<${t.el}>`;
    }
  };

  const genType = (depth: number): Ty => {
    const leaf = depth >= 4 || int(3) === 0;
    if (leaf)
      return pick<Ty>([{ k: "number" }, { k: "string" }, { k: "boolean" }, { k: "number" }]);
    switch (int(9)) {
      case 0:
      case 1:
      case 2:
        return { k: "array", el: genType(depth + 1) };
      case 3:
        return { k: "array", el: pick<Ty>([{ k: "optnum" }, { k: "numstr" }]) };
      case 4:
      case 5:
      case 6: {
        const name = `T${objCount++}`;
        // An empty interface is `{}` (any non-nullish value), which the subset rejects; a class may be empty.
        const n = int(6) + 1;
        const used = new Set<string>();
        const fields: [string, Ty][] = [];
        for (let i = 0; i < n; i++) {
          const f = pick(KEY_NAMES);
          if (used.has(f)) continue;
          used.add(f);
          fields.push([f, genType(depth + 1)]);
        }
        const t: Ty = { k: "obj", name, fields, cls: int(3) === 0 };
        if (t.cls) {
          decls.push(`class ${name} {`);
          for (const [f, ft] of fields) decls.push(`  ${f}: ${tsType(ft)};`);
          decls.push(
            `  constructor(${fields.map(([f, ft]) => `${f}: ${tsType(ft)}`).join(", ")}) {`,
          );
          for (const [f] of fields) decls.push(`    this.${f} = ${f};`);
          decls.push("  }", "}");
        } else {
          decls.push(`interface ${name} {`);
          for (const [f, ft] of fields) decls.push(`  ${f}: ${tsType(ft)};`);
          decls.push("}");
        }
        return t;
      }
      case 7:
        return { k: "map", key: pick(["string", "number"] as const), val: genType(depth + 1) };
      default:
        return { k: "set", el: pick(["string", "number"] as const) };
    }
  };

  const genNumber = (): string =>
    pick([
      () => String(int(10)),
      () => String(int(1000)),
      () => String(int(100000) * 7),
      () => `-${int(500)}`,
      () => `${int(100)}.${1 + int(99)}`,
      () => pick(["1e21", "-0", "0.1", "123456789", "NaN", "Infinity", "-1.5"]),
    ])();

  const genString = (): string => {
    const r = int(10);
    if (r < 5) return JSON.stringify(pick(WORDS));
    if (r < 8) return JSON.stringify("s".repeat(int(30)) + pick(WORDS));
    // Long strings, often with newlines: these are split into `'...' +` lines when nested.
    const lines = 1 + int(4);
    const parts: string[] = [];
    for (let i = 0; i < lines; i++) parts.push("w".repeat(5 + int(40)) + (int(2) ? " 'q'" : ""));
    return JSON.stringify(parts.join(int(3) ? "\n" : " ") + (int(4) === 0 ? "\n" : ""));
  };

  // An expression of type `t`; containers that need statements are built into a temp first.
  const genValue = (t: Ty, depth: number): string => {
    switch (t.k) {
      case "number":
        return genNumber();
      case "string":
        return genString();
      case "boolean":
        return pick(["true", "false"]);
      case "optnum":
        return int(3) === 0 ? "undefined" : genNumber();
      case "numstr":
        return int(2) === 0 ? genString() : genNumber();
      case "array": {
        const r = int(12);
        if (r === 0 && depth < 3 && isScalar(t.el)) {
          // A long array: past 100 entries Node prints `... N more items`.
          const v = `big${tmp++}`;
          const n = 95 + int(60);
          body.push(`const ${v}: ${tsType(t)} = [];`);
          body.push(`for (let i = 0; i < ${n}; i++) ${v}.push(${scalarFromI(t.el)});`);
          return v;
        }
        const n = r < 3 ? int(3) : r < 8 ? int(10) : int(30);
        const els: string[] = [];
        for (let i = 0; i < n; i++) els.push(genValue(t.el, depth + 1));
        if (n === 0) {
          const v = `e${tmp++}`;
          body.push(`const ${v}: ${tsType(t)} = [];`);
          return v;
        }
        return `[${els.join(", ")}]`;
      }
      case "obj": {
        if (t.cls)
          return `new ${t.name}(${t.fields.map(([, ft]) => genValue(ft, depth + 1)).join(", ")})`;
        const v = `o${tmp++}`;
        const lit = t.fields.map(([f, ft]) => `${f}: ${genValue(ft, depth + 1)}`).join(", ");
        body.push(`const ${v}: ${t.name} = { ${lit} };`);
        return v;
      }
      case "map": {
        const v = `m${tmp++}`;
        body.push(`const ${v} = new Map<${t.key}, ${tsType(t.val)}>();`);
        const n = int(8);
        for (let i = 0; i < n; i++) {
          const key = t.key === "string" ? JSON.stringify(pick(KEY_NAMES) + i) : String(i * 3);
          body.push(`${v}.set(${key}, ${genValue(t.val, depth + 1)});`);
        }
        return v;
      }
      case "set": {
        const v = `st${tmp++}`;
        body.push(`const ${v} = new Set<${t.el}>();`);
        const n = int(10);
        for (let i = 0; i < n; i++)
          body.push(`${v}.add(${t.el === "string" ? genString() : genNumber()});`);
        return v;
      }
    }
  };

  const count = 3 + int(4);
  const made: Ty[] = [];
  for (let i = 0; i < count; i++) {
    const t = genType(0);
    const e = genValue(t, 0);
    made.push(t);
    body.push(`const v${i}: ${tsType(t)} = ${e};`);
    body.push(
      int(4) === 0 ? `console.log("v${i}", v${i}, ${genNumber()});` : `console.log(v${i});`,
    );
  }
  // util.format lines. %j is only generated for values JSON can render (the validator rejects the
  // rest), and a run-time format string can meet any directive, so it gets only such values too.
  const formats = int(3);
  for (let f = 0; f < formats; f++) {
    const n = 1 + int(3);
    const idx = Array.from({ length: n }, () => int(count));
    const safe = idx.every((i) => jsonSafe(made[i]!, "top"));
    const pieces: string[] = [];
    const parts = 1 + int(5);
    for (let p = 0; p < parts; p++) {
      pieces.push(
        pick(["", "x", " ", "val=", "%%", "%x", "100%", " - "]) +
          pick(safe ? DIRECTIVES : DIRECTIVES.filter((d) => d !== "%j")),
      );
    }
    const fmt = pieces.join("") + pick(["", "%", " end", "%%"]);
    const argList = idx.map((i) => `v${i}`).join(", ");
    if (safe && int(2) === 0) {
      body.push(`const fmt${f}: string = [${JSON.stringify(fmt)}].join("");`);
      body.push(`console.log(fmt${f}, ${argList});`);
    } else {
      body.push(`console.log(${JSON.stringify(fmt)}, ${argList});`);
    }
  }
  if (int(4) === 0) {
    // A cycle through a class field: `<ref *1>` and `[Circular *1]`.
    decls.push(
      "class Cyc {",
      "  next: Cyc | null = null;",
      "  tag: string;",
      "  constructor(tag: string) {",
      "    this.tag = tag;",
      "  }",
      "}",
    );
    body.push('const c1 = new Cyc("one");', 'const c2 = new Cyc("two");', "c1.next = c2;");
    body.push(int(2) ? "c2.next = c1;" : "c2.next = c2;");
    body.push("console.log(c1);", "console.log([c1, c2]);");
  }
  return [...decls, ...body].join("\n") + "\n";
}

const DIRECTIVES = ["%s", "%d", "%i", "%f", "%j", "%o", "%O", "%c", ""];

// Whether JSON.stringify (and so %j) renders a value of type `t` at this position: a Map or Set
// only at the top (%j writes `{}`), an optional only at the top or as an object field.
function jsonSafe(t: Ty, pos: "top" | "field" | "nested"): boolean {
  switch (t.k) {
    case "number":
    case "string":
    case "boolean":
    case "numstr":
      return true;
    case "optnum":
      return pos !== "nested";
    case "array":
      return jsonSafe(t.el, "nested");
    case "obj":
      return t.fields.every(([, ft]) => jsonSafe(ft, "field"));
    case "map":
    case "set":
      return pos === "top";
  }
}

function isScalar(t: Ty): boolean {
  return (
    t.k === "number" ||
    t.k === "string" ||
    t.k === "boolean" ||
    t.k === "optnum" ||
    t.k === "numstr"
  );
}

// An element for index `i` of a long array.
function scalarFromI(t: Ty): string {
  switch (t.k) {
    case "number":
      return "(i * 37) % 1000";
    case "string":
      return '"s" + String(i % 13)';
    case "boolean":
      return "i % 3 === 0";
    case "optnum":
      return "i % 5 === 0 ? undefined : i";
    case "numstr":
      return 'i % 4 === 0 ? "q" + String(i) : i';
    default:
      throw new Error(`scalarFromI: ${t.k}`);
  }
}
