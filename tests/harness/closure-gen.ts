// Program generator for the closures + generics fuzzer (tests/slow/closure-fuzz.test.ts). Emits
// programs that share mutable variables between frames and closures (counter factories, closures
// made in `for (let ...)`, `for...of` and `while` bodies, nested closures, parameters reassigned
// after capture) and run erased generic functions and classes at number, string, object and union
// instantiations, printing every result. Every program is tsc-clean and deterministic, so a
// native-vs-Node divergence is a miscompile, never an artifact.
//
// Soundness notes:
//   - Captured-and-reassigned variables are numbers or strings: a union cell read after a call is
//     CS1241 by design, so the generator never narrows one.
//   - Arrays cross generic boundaries only as literals or spreads (`[...xs]`), and generic results
//     come back only from functions that build their result, which is what the subset admits.

import { makeRng } from "./fuzz-gen.js";

interface Inst {
  type: string;
  lits: string[];
  // An expression of this type derived from `x` (proves the value came back usable).
  use: (x: string) => string;
}

const INSTS: Inst[] = [
  { type: "number", lits: ["0", "1", "-2.5", "42", "1e21"], use: (x) => `${x} * 2 + 1` },
  { type: "string", lits: ['""', '"a"', '"hello"', '"42"'], use: (x) => `${x}.length` },
  { type: "boolean", lits: ["true", "false"], use: (x) => `(${x} ? "yes" : "no")` },
  { type: "Pt", lits: ["{ k: 1 }", "{ k: -3 }", "{ k: 7 }"], use: (x) => `${x}.k + 10` },
  {
    type: "number | string",
    lits: ["3", '"s"', "0", '"zz"'],
    use: (x) => `(typeof ${x} === "number" ? ${x} + 1 : ${x}.length)`,
  },
];

export function genClosureProgram(seed: number): string {
  const rng = makeRng(seed * 104729 + 7);
  const int = (n: number): number => Math.floor(rng() * n);
  const pickOf = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const out: string[] = [];
  out.push("interface Pt {", "  k: number;", "}");

  // Counter factories: one cell per factory call, shared by the returned closures.
  const step = 1 + int(5);
  out.push(
    "function makeCounter(start: number): { inc: () => number; get: () => number } {",
    "  let c = start;",
    `  return { inc: () => { c += ${step}; return c; }, get: () => c };`,
    "}",
  );
  out.push(`const ca = makeCounter(${int(10)});`, `const cb = makeCounter(${int(10)});`);
  for (let i = 0; i < 2 + int(4); i++) out.push(`${pickOf(["ca", "cb"])}.inc();`);
  out.push("console.log(ca.get(), cb.get(), ca.inc());");

  // Closures made in loops: per-iteration bindings, body mutation, continue, shared outer var.
  const n = 2 + int(4);
  const mut = int(3);
  out.push("const fs: (() => number)[] = [];");
  out.push(`for (let i = 0; i < ${n}; i++) {`);
  if (int(2) === 0) out.push(`  if (i === ${int(n)}) continue;`);
  out.push("  fs.push(() => i);");
  if (mut > 0) out.push(`  i += ${mut - 1};`);
  out.push("}");
  out.push('console.log(fs.map((f) => f()).join(","));');
  out.push("let shared = 0;", "const gs: (() => string)[] = [];");
  out.push(
    `for (let w of [${Array.from({ length: 1 + int(3) }, () => `"${"abc"[int(3)]}"`).join(", ")}]) {`,
  );
  out.push("  shared++;", "  gs.push(() => w + shared);", `  w = w + "${"xyz"[int(3)]}";`, "}");
  out.push('console.log(gs.map((g) => g()).join(" "));');
  out.push("let wk = 0;", "const hs: (() => number)[] = [];");
  out.push(
    `while (wk < ${1 + int(3)}) {`,
    "  let sq = wk * wk;",
    "  hs.push(() => sq++);",
    "  wk++;",
    "}",
  );
  out.push("console.log(hs.map((h) => h() + h()).join(", "));");

  // Nested closures sharing one cell, and a parameter reassigned after capture.
  out.push(
    "function nest(seed0: number): number {",
    "  let depth = seed0;",
    "  const outer = (): (() => number) => {",
    `    depth += ${1 + int(3)};`,
    "    return () => {",
    `      depth *= ${2 + int(2)};`,
    "      return depth;",
    "    };",
    "  };",
    "  const inner = outer();",
    "  inner();",
    "  seed0 = depth + inner();",
    "  const get = (): number => seed0;",
    `  seed0 += ${int(5)};`,
    "  return get() + depth;",
    "}",
    `console.log(nest(${int(4)}), nest(${int(4)}));`,
  );

  // Erased generics.
  out.push(
    "function idG<T>(x: T): T {",
    "  return x;",
    "}",
    "function firstG<T>(xs: T[], d: T): T {",
    "  return xs.length > 0 ? xs[0]! : d;",
    "}",
    "function mapG<T, U>(xs: T[], f: (x: T) => U): U[] {",
    "  const r: U[] = [];",
    "  for (const x of xs) r.push(f(x));",
    "  return r;",
    "}",
    "class StackG<T> {",
    "  items: T[] = [];",
    "  push(x: T): void {",
    "    this.items.push(x);",
    "  }",
    "  pop(): T | undefined {",
    "    return this.items.pop();",
    "  }",
    "  size(): number {",
    "    return this.items.length;",
    "  }",
    "  toArray(): T[] {",
    "    return [...this.items];",
    "  }",
    "}",
    "class BoxG<T> {",
    "  v: T;",
    "  constructor(v: T) {",
    "    this.v = v;",
    "  }",
    "  swap(n: T): T {",
    "    const old = this.v;",
    "    this.v = n;",
    "    return old;",
    "  }",
    "}",
  );
  for (let b = 0; b < 3; b++) {
    const inst = pickOf(INSTS);
    const t = inst.type;
    const l = (): string => pickOf(inst.lits);
    const v = `v${b}`;
    out.push(`const ${v}: ${t} = idG<${t}>(${l()});`, `console.log(${inst.use(v)}, ${v});`);
    out.push(
      `const f${b} = firstG<${t}>([${l()}, ${l()}], ${l()});`,
      `console.log(${inst.use(`f${b}`)});`,
    );
    out.push(`console.log(mapG<${t}, string>([${l()}, ${l()}], (x) => String(${inst.use("x")})));`);
    out.push(`const s${b} = new StackG<${t}>();`);
    for (let i = 0; i < 1 + int(4); i++) out.push(`s${b}.push(${l()});`);
    out.push(
      `const p${b} = s${b}.pop();`,
      `if (p${b} !== undefined) console.log(${inst.use(`p${b}`)});`,
      `console.log(s${b}.size(), s${b}.toArray().length, s${b});`,
      `const bx${b} = new BoxG<${t}>(${l()});`,
      `const old${b} = bx${b}.swap(${l()});`,
      `console.log(${inst.use(`old${b}`)}, bx${b}.v, bx${b});`,
    );
  }

  // A generic closure over a mutable cell.
  out.push(
    "function tally<T>(xs: T[]): () => number {",
    "  let calls = 0;",
    "  return () => {",
    "    calls++;",
    "    return calls * xs.length;",
    "  };",
    "}",
    `const t0 = tally([${Array.from({ length: int(4) }, () => int(9)).join(", ")}]);`,
    "t0();",
    "console.log(t0());",
  );
  return out.join("\n") + "\n";
}
