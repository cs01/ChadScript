import { parseFile } from "./parser.js";
import { lowerModule } from "./hir/lower.js";
import { emitModule } from "./codegen/emitter.js";
import { setSourceContext } from "./errors.js";
import { readFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join, dirname } from "path";

export interface CompileOptions {
  input: string;
  output: string;
  emitIR?: boolean;
}

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const BRIDGE_SRCS = [
  join(ROOT, "c_bridges", "v2-string-bridge.c"),
  join(ROOT, "c_bridges", "v2-array-bridge.c"),
  join(ROOT, "c_bridges", "v2-error-bridge.c"),
];

export function compile(opts: CompileOptions): void {
  const source = readFileSync(opts.input, "utf-8");
  setSourceContext(source, opts.input);
  const ast = parseFile(opts.input);
  const absPath = join(process.cwd(), opts.input);
  const hir = lowerModule(ast, source, absPath);

  const tmpObj = join(tmpdir(), `chad2-${process.pid}.o`);
  const bridgeObjs = BRIDGE_SRCS.map((_, i) =>
    join(tmpdir(), `chad2-bridge-${process.pid}-${i}.o`),
  );
  const irPath = opts.emitIR ? opts.output + ".ll" : undefined;

  try {
    emitModule(hir, tmpObj, irPath);

    if (opts.emitIR) return;

    for (let i = 0; i < BRIDGE_SRCS.length; i++) {
      execSync(`clang -c -O2 -o ${bridgeObjs[i]} ${BRIDGE_SRCS[i]}`, { stdio: "inherit" });
    }
    execSync(`clang -g -O2 -o ${opts.output} ${tmpObj} ${bridgeObjs.join(" ")}`, {
      stdio: "inherit",
    });
    if (process.platform === "darwin") {
      execSync(`dsymutil -q ${opts.output}`, { stdio: "inherit" });
    }
  } finally {
    try {
      unlinkSync(tmpObj);
    } catch {}
    for (const o of bridgeObjs) {
      try {
        unlinkSync(o);
      } catch {}
    }
  }
}
