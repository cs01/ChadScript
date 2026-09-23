// `chad doctor`: checks everything the compiler needs on this machine and says how to fix what is
// missing, then proves the whole path by compiling and running a hello world.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLANG, MILO, OPT, miloPin } from "./driver/toolchain.js";
import { loadProgram } from "./frontend/program.js";
import { validate } from "./validate/validate.js";
import { build } from "./driver/build.js";
import { nodeLoader } from "./fallback.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

function run(cmd: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd, timeout: 600_000 });
  if (r.error) return { ok: false, out: r.error.message };
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function firstLine(s: string): string {
  return s.split("\n")[0] ?? "";
}

// `--import` (used to load tsx for `--fallback=node`) needs Node 18.19 / 20.6 or newer.
function nodeSupportsImport(version: string): boolean {
  const m = /^v(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 20 || (major === 20 && minor >= 6) || (major === 18 && minor >= 19);
}

function checkBun(): Check {
  const v = process.versions["bun"];
  return v
    ? { name: "bun", ok: true, detail: v }
    : {
        name: "bun",
        ok: false,
        detail: "not running under bun",
        fix: "install bun (https://bun.sh) and run the compiler with `bin/chad`",
      };
}

function checkNode(): Check[] {
  const r = run("node", ["--version"]);
  if (!r.ok) {
    return [
      {
        name: "node",
        ok: false,
        detail: "not found on PATH",
        fix: "install Node.js 20.6 or newer (https://nodejs.org); tests and --fallback=node use it",
      },
    ];
  }
  const version = firstLine(r.out);
  const out: Check[] = [];
  if (!nodeSupportsImport(version)) {
    out.push({
      name: "node",
      ok: false,
      detail: `${version} (no --import)`,
      fix: "upgrade Node.js to 20.6 or newer",
    });
    return out;
  }
  out.push({ name: "node", ok: true, detail: version });
  const tsx = run("node", ["--import", nodeLoader(), "-e", "0"]);
  out.push(
    tsx.ok
      ? { name: "tsx", ok: true, detail: "loads under node (for --fallback=node)" }
      : {
          name: "tsx",
          ok: false,
          detail: firstLine(tsx.out),
          fix: "run `bun install` in the ChadScript checkout",
        },
  );
  return out;
}

function checkTool(name: string, cmd: string, envVar: string): Check {
  const r = run(cmd, ["--version"]);
  if (!r.ok) {
    return {
      name,
      ok: false,
      detail: `\`${cmd}\` not found`,
      fix: process.env[envVar]
        ? `${envVar} is set to \`${cmd}\`, which does not run; point it at an installed ${name} or unset it`
        : `install LLVM (macOS: \`brew install llvm\`; Debian/Ubuntu: \`apt install clang-18 llvm-18\`) ` +
          `and put \`${cmd}\` on PATH, or set ${envVar} to its path`,
    };
  }
  const v = /version (\d+\.\d+\.\d+)/.exec(r.out)?.[1] ?? firstLine(r.out);
  return { name, ok: true, detail: `${v} (${cmd})` };
}

function checkMilo(): Check {
  const pin = miloPin();
  if (process.env["CHAD_MILO"]) {
    return existsSync(MILO)
      ? { name: "milo", ok: true, detail: `CHAD_MILO=${MILO}` }
      : {
          name: "milo",
          ok: false,
          detail: `CHAD_MILO=${MILO} does not exist`,
          fix: "unset CHAD_MILO",
        };
  }
  const head = (): string => run("git", ["-C", join(repoRoot, ".milo"), "rev-parse", "HEAD"]).out;
  if (!existsSync(MILO) || head() !== pin) {
    // The pinned compiler is a shallow fetch of one commit; fetch it now rather than only telling.
    process.stderr.write(
      `chad doctor: fetching the pinned Milo compiler (${pin.slice(0, 12)})...\n`,
    );
    run("sh", [join(repoRoot, "scripts", "setup-milo.sh")], repoRoot);
  }
  if (existsSync(MILO) && head() === pin) {
    return { name: "milo", ok: true, detail: `pinned ${pin.slice(0, 12)}` };
  }
  return {
    name: "milo",
    ok: false,
    detail: `pinned compiler ${pin.slice(0, 12)} missing`,
    fix: "run `sh scripts/setup-milo.sh` in the ChadScript checkout (needs git and network)",
  };
}

// Compile and run a one-line program: the runtime build, the link and the binary all work.
function checkHello(): Check {
  const dir = mkdtempSync(join(tmpdir(), "chad-doctor-"));
  const src = join(dir, "hello.ts");
  const bin = join(dir, "hello");
  writeFileSync(src, 'console.log("hello from chad");\n');
  try {
    const loaded = loadProgram(src);
    validate(loaded);
    build(loaded, { outPath: bin });
  } catch (e) {
    return {
      name: "hello world",
      ok: false,
      detail: `compile failed: ${firstLine((e as Error).message)}`,
      fix: "fix the failures above first; if they all pass, please report this",
    };
  }
  const r = run(bin, []);
  return r.ok && r.out === "hello from chad"
    ? { name: "hello world", ok: true, detail: "compiled and ran" }
    : {
        name: "hello world",
        ok: false,
        detail: `the binary printed ${JSON.stringify(r.out)}`,
        fix: "please report this with the output of `chad doctor`",
      };
}

export function doctor(): number {
  const checks: Check[] = [checkBun(), ...checkNode()];
  checks.push(checkTool("clang", CLANG, "CHAD_CLANG"), checkTool("opt", OPT, "CHAD_OPT"));
  checks.push(checkMilo());
  const toolsOk = checks.every((c) => c.ok || c.name === "node" || c.name === "tsx");
  checks.push(
    toolsOk
      ? checkHello()
      : { name: "hello world", ok: false, detail: "skipped: a required tool is missing" },
  );
  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    process.stdout.write(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name.padEnd(width)}  ${c.detail}\n`);
    if (!c.ok && c.fix) process.stdout.write(`        ${" ".repeat(width)}  fix: ${c.fix}\n`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  process.stdout.write(failed === 0 ? "\nall checks passed\n" : `\n${failed} check(s) failed\n`);
  return failed === 0 ? 0 : 1;
}
