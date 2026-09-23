// ICE sweep: compile mechanical mutations of every differential fixture (tests/fixtures/run/**) up
// to IR and report any crash that is not a CS#### rejection. Mutants that no longer typecheck
// (CS0001) or that the validator rejects are fine; an internal compiler error (CS9000) or an
// uncaught exception on a tsc-clean program is a compiler bug. Findings are grouped by their
// message with identifiers and numbers masked, one line per distinct crash, with a repro path.
//
//   bun run scripts/ice-sweep.ts [--filter substr] [--per-kind 3]
//
// Mutations (each applied at a few AST sites per fixture, one site per mutant):
//   let      `const` -> `let` for one declaration list
//   paren    wrap one expression (initializer, argument, return value, operand) in parentheses
//   stmt     repeat one call expression as its own statement just before its statement
//   inline   replace one read of a `const` with its (parenthesized) initializer

import ts from "typescript";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
  cpSync,
  readFileSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadProgram } from "../src/frontend/program.js";
import { validate } from "../src/validate/validate.js";
import { emitIr } from "../src/driver/build.js";
import { DiagnosticError } from "../src/diagnostics.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = join(repo, "tests", "fixtures", "run");
const outDir = join(repo, ".fuzz", "ice");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const filter = argValue("--filter");
const perKind = Number(argValue("--per-kind") ?? "3");

interface Edit {
  start: number;
  end: number;
  text: string;
}
interface Mutant {
  kind: string;
  edits: Edit[];
}

function apply(src: string, edits: Edit[]): string {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start))
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// Deterministic spread of `n` picks over `xs`.
function spread<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const step = xs.length / n;
  return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]!);
}

function mutants(src: string, file: string): Mutant[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true);
  const lets: Mutant[] = [];
  const parens: Mutant[] = [];
  const stmts: Mutant[] = [];
  const inlines: Mutant[] = [];
  const consts = new Map<string, ts.VariableDeclaration>();

  const wrap = (e: ts.Expression): Mutant => ({
    kind: "paren",
    edits: [{ start: e.getStart(sf), end: e.getEnd(), text: `(${e.getText(sf)})` }],
  });

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.Const) {
      const kw = node.getStart(sf);
      if (src.startsWith("const", kw))
        lets.push({ kind: "let", edits: [{ start: kw, end: kw + 5, text: "let" }] });
      for (const d of node.declarations)
        if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, d);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) parens.push(wrap(node.initializer));
    if (ts.isCallExpression(node)) {
      for (const a of node.arguments) if (!ts.isSpreadElement(a)) parens.push(wrap(a));
      // Repeat the call as a statement before the statement containing it.
      let st: ts.Node = node;
      while (st.parent && !ts.isBlock(st.parent) && !ts.isSourceFile(st.parent)) st = st.parent;
      if (ts.isStatement(st) && !ts.isExpressionStatement(st) && st !== node) {
        const at = st.getStart(sf);
        stmts.push({
          kind: "stmt",
          edits: [{ start: at, end: at, text: `${node.getText(sf)};\n` }],
        });
      }
    }
    if (ts.isReturnStatement(node) && node.expression) parens.push(wrap(node.expression));
    if (ts.isBinaryExpression(node)) parens.push(wrap(node.left), wrap(node.right));
    if (ts.isIdentifier(node)) {
      const d = consts.get(node.text);
      const p = node.parent;
      const isRead =
        d !== undefined &&
        d.name !== node &&
        node.getStart(sf) > d.getEnd() &&
        !(ts.isPropertyAccessExpression(p) && p.name === node) &&
        !(ts.isPropertyAssignment(p) && p.name === node) &&
        // A shadowing declaration can make this unsound; tsc catches most of those, which only
        // costs a skipped mutant (and the sweep reports crashes, not output).
        !ts.isShorthandPropertyAssignment(p);
      if (isRead && d.initializer)
        inlines.push({
          kind: "inline",
          edits: [
            {
              start: node.getStart(sf),
              end: node.getEnd(),
              text: `(${d.initializer.getText(sf)})`,
            },
          ],
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [
    ...spread(lets, perKind),
    ...spread(parens, perKind * 2),
    ...spread(stmts, perKind),
    ...spread(inlines, perKind),
  ];
}

// Every differential fixture: a single file, or a directory program's main.ts.
function fixtures(): { entry: string; dir: string | null }[] {
  const out: { entry: string; dir: string | null }[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        const main = join(p, "main.ts");
        try {
          statSync(main);
          out.push({ entry: main, dir: p });
        } catch {
          walk(p);
        }
      } else if (name.endsWith(".ts")) out.push({ entry: p, dir: null });
    }
  };
  walk(fixturesRoot);
  return out;
}

type Outcome = { kind: "ok" | "rejected" | "tsc" } | { kind: "crash"; message: string };

function compile(entry: string): Outcome {
  try {
    const loaded = loadProgram(entry);
    validate(loaded);
    emitIr(loaded);
    return { kind: "ok" };
  } catch (e) {
    if (e instanceof DiagnosticError) {
      const tsc = e.diagnostics.every((d) => d.code === "CS0001");
      return { kind: tsc ? "tsc" : "rejected" };
    }
    const err = e as Error;
    const first = `${err.name}: ${err.message}`.split("\n")[0]!;
    return { kind: "crash", message: first };
  }
}

// Group crashes by message shape: identifiers in backticks, quoted text and numbers are masked.
const signature = (m: string): string =>
  m
    .replace(/`[^`]*`/g, "`_`")
    .replace(/'[^']*'/g, "'_'")
    .replace(/\d+/g, "N");

mkdirSync(outDir, { recursive: true });
const groups = new Map<string, { message: string; repros: string[] }>();
let total = 0;
const counts = { ok: 0, rejected: 0, tsc: 0, crash: 0 };
for (const fx of fixtures()) {
  const rel = relative(fixturesRoot, fx.entry);
  if (filter && !rel.includes(filter)) continue;
  const src = readFileSync(fx.entry, "utf8");
  if (/@known-bug/.test(src)) continue;
  mutants(src, fx.entry).forEach((m, i) => {
    total++;
    const tmp = mkdtempSync(join(tmpdir(), "chad-ice-"));
    if (fx.dir) cpSync(fx.dir, tmp, { recursive: true });
    const entry = join(tmp, "main.ts");
    writeFileSync(entry, apply(src, m.edits));
    const r = compile(entry);
    counts[r.kind]++;
    if (r.kind !== "crash") return;
    const sig = signature(r.message);
    const repro = join(
      outDir,
      `${rel.replace(/[/\\]/g, "__").replace(/\.ts$/, "")}.${m.kind}${i}.ts`,
    );
    writeFileSync(repro, apply(src, m.edits));
    const g = groups.get(sig) ?? { message: r.message, repros: [] };
    g.repros.push(repro);
    groups.set(sig, g);
  });
}

process.stdout.write(
  `${total} mutants: ${counts.ok} compiled, ${counts.rejected} rejected, ${counts.tsc} not tsc-clean, ${counts.crash} crashed\n`,
);
for (const g of [...groups.values()].sort((a, b) => b.repros.length - a.repros.length)) {
  process.stdout.write(
    `\n[${g.repros.length}] ${g.message}\n  ${g.repros.slice(0, 3).join("\n  ")}\n`,
  );
}
process.exit(groups.size > 0 ? 1 : 0);
