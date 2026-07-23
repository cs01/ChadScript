// Benchmark runner: the same program in ChadScript (native), Node, and Rust.
//
// Each benchmark is a directory under benchmarks/ holding `main.ts` (compiled natively AND run
// under Node — one source, two runtimes, which is the whole point of the subset) and `main.rs`
// (the systems-language reference). All three must print identical stdout or the result is thrown
// out: a benchmark that computes something different is not a benchmark.
//
//   bun run scripts/bench.ts            # everything
//   bun run scripts/bench.ts fib sieve  # named benchmarks only

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProgram } from "../src/frontend/program.js";
import { validate } from "../src/validate/validate.js";
import { emitIr, linkIr, runtimeObjects } from "../src/driver/build.js";
import { writeFileSync } from "node:fs";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const benchRoot = join(root, "benchmarks");
const outDir = join(root, ".build", "bench");

const RUNS = 5; // best-of; enough to shake off scheduler noise without dragging

interface Timing {
  label: string;
  ms: number;
}

async function timeIt(cmd: string, args: string[]): Promise<number> {
  let best = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await execFileAsync(cmd, args, { maxBuffer: 64 * 1024 * 1024 });
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

async function stdoutOf(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

// Compile `main.ts` to a native binary at -O2, the same path `chad build` takes.
async function buildNative(entry: string, out: string): Promise<void> {
  const loaded = loadProgram(entry);
  validate(loaded);
  const irPath = `${out}.ll`;
  writeFileSync(irPath, emitIr(loaded));
  await linkIr(irPath, out, "2", runtimeObjects());
}

async function buildRust(entry: string, out: string): Promise<void> {
  await execFileAsync("rustc", ["-O", "-o", out, entry]);
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

async function runBenchmark(name: string): Promise<void> {
  const dir = join(benchRoot, name);
  const tsEntry = join(dir, "main.ts");
  const rsEntry = join(dir, "main.rs");
  if (!existsSync(tsEntry)) {
    console.log(`${name}: no main.ts, skipped`);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  const nativeBin = join(outDir, `${name}.chad`);
  const rustBin = join(outDir, `${name}.rust`);

  await buildNative(tsEntry, nativeBin);
  const hasRust = existsSync(rsEntry);
  if (hasRust) await buildRust(rsEntry, rustBin);

  // Correctness gate first: same stdout from every runtime, or the timings are meaningless.
  const nativeOut = await stdoutOf(nativeBin, []);
  const nodeOut = await stdoutOf("node", [tsEntry]);
  const rustOut = hasRust ? await stdoutOf(rustBin, []) : nativeOut;
  if (nativeOut !== nodeOut || nativeOut !== rustOut) {
    console.log(`${name}: OUTPUT MISMATCH — not comparable`);
    console.log(`  chad: ${nativeOut}`);
    console.log(`  node: ${nodeOut}`);
    if (hasRust) console.log(`  rust: ${rustOut}`);
    return;
  }

  const timings: Timing[] = [
    { label: "chad", ms: await timeIt(nativeBin, []) },
    { label: "node", ms: await timeIt("node", [tsEntry]) },
  ];
  if (hasRust) timings.push({ label: "rust", ms: await timeIt(rustBin, []) });

  const fastest = Math.min(...timings.map((t) => t.ms));
  const cells = timings
    .map((t) => `${t.label} ${fmt(t.ms)} (${(t.ms / fastest).toFixed(2)}x)`)
    .join("   ");
  console.log(`${name.padEnd(10)} ${cells}`);
}

const requested = process.argv.slice(2);
const names =
  requested.length > 0
    ? requested
    : readdirSync(benchRoot).filter((e) => existsSync(join(benchRoot, e, "main.ts")));

console.log(`best of ${RUNS} runs, wall clock incl. process startup\n`);
for (const name of names.sort()) {
  try {
    await runBenchmark(name);
  } catch (e) {
    console.log(`${name}: FAILED — ${(e as Error).message.split("\n")[0]}`);
  }
}
