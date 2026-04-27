import { parseFile } from "./parser.js";
import { lowerModule } from "./hir/lower.js";
import { emitModule } from "./codegen/emitter.js";
import { setSourceContext } from "./errors.js";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join, dirname } from "path";

export interface CompileOptions {
  input: string;
  output: string;
  emitIR?: boolean;
}

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const BRIDGE_SRC = join(ROOT, "c_bridges", "v2-string-bridge.c");

export function compile(opts: CompileOptions): void {
  const source = readFileSync(opts.input, "utf-8");
  setSourceContext(source, opts.input);
  const ast = parseFile(opts.input);
  const hir = lowerModule(ast);

  const tmpObj = join(tmpdir(), `chad2-${process.pid}.o`);
  const bridgeObj = join(tmpdir(), `chad2-bridge-${process.pid}.o`);
  const irPath = opts.emitIR ? opts.output + ".ll" : undefined;

  try {
    emitModule(hir, tmpObj, irPath);

    if (opts.emitIR) return;

    execSync(`clang -c -O2 -o ${bridgeObj} ${BRIDGE_SRC}`, { stdio: "inherit" });
    execSync(`clang -O2 -o ${opts.output} ${tmpObj} ${bridgeObj}`, {
      stdio: "inherit",
    });
  } finally {
    try {
      unlinkSync(tmpObj);
    } catch {}
    try {
      unlinkSync(bridgeObj);
    } catch {}
  }
}
