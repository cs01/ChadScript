// Structural-subtyping program generator. TypeScript lets any value whose fields are a superset
// of an interface's (in any order, classes or literals) flow into that interface, and the old
// value model laid objects out by static type, so these programs are where it miscompiles.
// Every generated program is tsc-clean and deterministic: a native-vs-Node divergence is a real
// layout bug, never a generator artifact.
//
// Soundness notes:
//   - Each field NAME has one type per program, so "fields are a superset" is exactly tsc's
//     assignability rule and no generated assignment can fail to typecheck.
//   - Literals are bound to an inferred `const` first and only then passed at interface type;
//     assigning a literal with extra fields directly to an interface trips tsc's excess-property
//     check.

import { makeRng } from "./fuzz-gen.js";

type FieldType = "number" | "string" | "boolean";

interface Iface {
  name: string;
  fields: string[]; // declaration order
}

interface Obj {
  name: string;
  fields: string[]; // allocation order (literal order or class declaration order)
}

export function genSubtypeProgram(seed: number): string {
  const rng = makeRng(seed);
  const int = (n: number): number => Math.floor(rng() * n);
  const pick = <T>(xs: T[]): T => xs[int(xs.length)]!;
  const shuffle = <T>(xs: T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const subset = (xs: string[], min: number): string[] => {
    const s = shuffle(xs).slice(0, min + int(xs.length - min + 1));
    return shuffle(s);
  };

  const fieldCount = 3 + int(4);
  const fieldNames = Array.from({ length: fieldCount }, (_, i) => `f${i}`);
  const ftype = new Map<string, FieldType>(
    fieldNames.map((f) => [f, pick<FieldType>(["number", "string", "boolean"])]),
  );
  let counter = 0;
  const lit = (f: string): string => {
    counter++;
    switch (ftype.get(f)!) {
      case "number":
        return String(counter * 7 - 20);
      case "string":
        return `"s${counter}"`;
      case "boolean":
        return counter % 2 === 0 ? "true" : "false";
    }
  };

  const out: string[] = [];
  const ifaces: Iface[] = [];
  for (let i = 0; i < 2 + int(3); i++) {
    const it: Iface = { name: `I${i}`, fields: subset(fieldNames, 1) };
    ifaces.push(it);
    out.push(`interface ${it.name} {`);
    for (const f of it.fields) out.push(`  ${f}: ${ftype.get(f)};`);
    out.push(`}`);
  }

  const objs: Obj[] = [];
  for (let i = 0; i < 1 + int(3); i++) {
    const cls = { name: `C${i}`, fields: subset(fieldNames, 1) };
    out.push(`class ${cls.name} {`);
    for (const f of cls.fields) out.push(`  ${f}: ${ftype.get(f)} = ${lit(f)};`);
    out.push(`}`);
    const o = { name: `c${i}`, fields: cls.fields };
    out.push(`const ${o.name} = new ${cls.name}();`);
    objs.push(o);
  }
  for (let i = 0; i < 2 + int(4); i++) {
    const o = { name: `o${i}`, fields: subset(fieldNames, 1) };
    out.push(`const ${o.name} = { ${o.fields.map((f) => `${f}: ${lit(f)}`).join(", ")} };`);
    objs.push(o);
  }

  const fits = (o: { fields: string[] }, it: Iface): boolean =>
    it.fields.every((f) => o.fields.includes(f));

  for (const it of ifaces) {
    out.push(`function read${it.name}(v: ${it.name}): void {`);
    out.push(`  console.log("${it.name}", ${it.fields.map((f) => `v.${f}`).join(", ")});`);
    out.push(`}`);
    const f = pick(it.fields);
    out.push(`function write${it.name}(v: ${it.name}): void {`);
    out.push(`  v.${f} = ${lit(f)};`);
    out.push(`}`);
  }

  for (let step = 0; step < 6 + int(6); step++) {
    const it = pick(ifaces);
    const fitting = objs.filter((o) => fits(o, it));
    if (fitting.length === 0) continue;
    const o = pick(fitting);
    switch (int(4)) {
      case 0:
        out.push(`read${it.name}(${o.name});`);
        break;
      case 1:
        out.push(`write${it.name}(${o.name});`);
        out.push(`console.log("${o.name}", ${o.fields.map((f) => `${o.name}.${f}`).join(", ")});`);
        break;
      case 2: {
        const arr = `a${step}`;
        out.push(`const ${arr}: ${it.name}[] = [${fitting.map((x) => x.name).join(", ")}];`);
        out.push(`for (const v of ${arr}) read${it.name}(v);`);
        break;
      }
      case 3: {
        // Alias through a second interface the first one satisfies (reordered views).
        const narrower = ifaces.filter((j) => fits(it, j));
        const j = pick(narrower);
        out.push(`{`);
        out.push(`  const v: ${it.name} = ${o.name};`);
        out.push(`  const w: ${j.name} = v;`);
        out.push(`  write${j.name}(w);`);
        out.push(`  read${it.name}(v);`);
        out.push(`}`);
        break;
      }
    }
  }
  return out.join("\n") + "\n";
}
