// Program generator for the Value-union fuzzer (tests/slow/union-fuzz.test.ts). Emits programs over
// unions of number / string / boolean / undefined / null that move values through assignments,
// function parameters and returns, arrays and object fields, narrow them with typeof, ===, truthiness
// and ??, and print everything (console.log, String(), templates, JSON.stringify). Every program is
// tsc-clean and deterministic, so a native-vs-Node divergence is a miscompile, never an artifact.
//
// Soundness notes:
//   - Values come out of `pick(i)` / array reads / object fields, which tsc does NOT narrow, so the
//     un-narrowed Value paths are exercised; assignments of literals then narrow a variable, which
//     exercises the unbox paths.
//   - Only primitive members, so String() and template interpolation are in the subset.
//   - JSON.stringify only sees objects and arrays whose elements cannot be undefined at the top of
//     an array element (Node writes `null` there, which the subset does not model), so array
//     element unions exclude undefined.

import { makeRng } from "./fuzz-gen.js";

type Kind = "number" | "string" | "boolean" | "undefined" | "null";

const UNIONS: Kind[][] = [
  ["number", "string"],
  ["string", "undefined", "number"],
  ["boolean", "string"],
  ["number", "null", "boolean"],
  ["string", "number", "boolean", "null", "undefined"],
  ["number", "boolean"],
  ["string", "null"],
];

const LITERALS: Record<Kind, string[]> = {
  number: ["0", "1", "-1", "2.5", "NaN", "-0", "42", "1e21", "0.1"],
  string: ['""', '"a"', '"0"', '"hello"', '"42"', '"true"', '"null"'],
  boolean: ["true", "false"],
  undefined: ["undefined"],
  null: ["null"],
};

function typeText(u: Kind[]): string {
  return u.join(" | ");
}

export function genUnionProgram(seed: number): string {
  const rng = makeRng(seed * 7919 + 13);
  const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const lines: string[] = [];
  const unions = [pickOf(UNIONS), pickOf(UNIONS), pickOf(UNIONS)];
  const lit = (u: Kind[]): string => pickOf(LITERALS[pickOf(u)]);
  // A literal for the right side of `===`: never NaN, which tsc flags as always-false (TS2845).
  const cmpLit = (u: Kind[]): string => {
    const l = lit(u);
    return l === "NaN" ? "0" : l;
  };

  // A source of un-narrowed values per union: a function returning one member per index.
  unions.forEach((u, n) => {
    const t = typeText(u);
    lines.push(`function pick${n}(i: number): ${t} {`);
    const cases = Array.from({ length: 4 }, () => lit(u));
    cases.forEach((c, i) => lines.push(`  if (i === ${i}) return ${c};`));
    lines.push(`  return ${lit(u)};`);
    lines.push(`}`);
  });

  // A function that narrows its parameter every way and prints what it sees.
  unions.forEach((u, n) => {
    const t = typeText(u);
    lines.push(`function show${n}(v: ${t}): string {`);
    lines.push(`  let out = typeof v + ":" + String(v);`);
    if (u.includes("number")) {
      lines.push(`  if (typeof v === "number") out += "|n" + (v * 2 + 1).toString();`);
    }
    if (u.includes("string")) {
      lines.push(`  if (typeof v === "string") out += "|s" + v.length + v.toUpperCase();`);
    }
    if (u.includes("boolean")) lines.push(`  if (typeof v === "boolean") out += v ? "|T" : "|F";`);
    if (u.includes("null")) lines.push(`  if (v === null) out += "|null";`);
    if (u.includes("undefined")) lines.push(`  if (v === undefined) out += "|undef";`);
    lines.push(`  out += v ? "|truthy" : "|falsy";`);
    lines.push(`  out += \`|\${v}\``);
    lines.push(`  return out;`);
    lines.push(`}`);
  });

  // Object and array carriers.
  const fieldUnion = unions[0]!;
  const elemUnion = unions[1]!.filter((k) => k !== "undefined");
  const elemKinds: Kind[] = elemUnion.length > 1 ? elemUnion : ["number", "string"];
  const elemT = typeText(elemKinds);
  const elemLit = (): string => lit(elemKinds);
  lines.push(`interface Rec { a: ${typeText(fieldUnion)}; b: ${typeText(unions[2]!)} }`);

  const stmts = 6 + Math.floor(rng() * 8);
  lines.push(`let x0: ${typeText(unions[0]!)} = ${lit(unions[0]!)};`);
  lines.push(`let x1: ${typeText(unions[1]!)} = ${lit(unions[1]!)};`);
  lines.push(`const arr: (${elemT})[] = [${elemLit()}, ${elemLit()}];`);
  lines.push(`const rec: Rec = { a: ${lit(fieldUnion)}, b: ${lit(unions[2]!)} };`);
  for (let s = 0; s < stmts; s++) {
    const i = Math.floor(rng() * 5);
    switch (Math.floor(rng() * 12)) {
      case 0:
        lines.push(`x0 = pick0(${i});`);
        break;
      case 1:
        lines.push(`x1 = ${lit(unions[1]!)};`);
        break;
      case 2:
        lines.push(`console.log(x0, x1, show0(x0), show1(x1));`);
        break;
      case 3:
        lines.push(`arr.push(${elemLit()});`);
        break;
      case 4:
        lines.push(`console.log(arr, arr.length, arr.join("/"), arr.includes(${elemLit()}));`);
        break;
      case 5:
        lines.push(`rec.a = pick0(${i});`);
        lines.push(`rec.b = pick2(${i});`);
        break;
      case 6:
        lines.push(`console.log(rec, JSON.stringify(rec), show0(rec.a), show2(rec.b));`);
        break;
      case 7:
        lines.push(`console.log(pick1(${i}) ?? "dflt", pick0(${i}) === pick0(${(i + 1) % 5}));`);
        break;
      case 8:
        lines.push(
          `for (const e of arr) console.log(typeof e, e === ${cmpLit(elemKinds)}, e ? "t" : "f", \`[\${e}]\`);`,
        );
        break;
      case 9: {
        lines.push(`const at${s} = arr[${i}];`);
        lines.push(`if (at${s} !== undefined) console.log("at", at${s}, typeof at${s});`);
        lines.push(`else console.log("no element", ${i});`);
        break;
      }
      case 10:
        // Compared through pick0 (never narrowed): comparing a narrowed variable to a literal of
        // another kind is a tsc "no overlap" error.
        lines.push(
          `const c${s}: ${typeText(unions[2]!)} = pick0(${i}) === ${cmpLit(unions[0]!)} ? pick2(${i}) : ${lit(unions[2]!)};`,
        );
        lines.push(`console.log(c${s}, show2(c${s}));`);
        break;
      default:
        lines.push(`console.log([x0, x1], { x0, x1 }, String(pick1(${i})));`);
        break;
    }
  }
  lines.push(`console.log(x0, x1, arr, rec);`);
  lines.push(`console.log(show0(x0), show1(x1), show2(pick2(3)), pick1(2));`);
  return lines.join("\n") + "\n";
}
