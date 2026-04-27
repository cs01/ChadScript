import { parseFile } from "./parser.js";
import { lowerModule } from "./hir/lower.js";
import { emitModule } from "./codegen/emitter.js";
import { setSourceContext } from "./errors.js";
import { readFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

export interface CompileOptions {
  input: string;
  output: string;
  emitIR?: boolean;
}

export function compile(opts: CompileOptions): void {
  const source = readFileSync(opts.input, "utf-8");
  setSourceContext(source, opts.input);
  const ast = parseFile(opts.input);
  const hir = lowerModule(ast);

  const tmpObj = join(tmpdir(), `chad2-${process.pid}.o`);
  const irPath = opts.emitIR ? opts.output + ".ll" : undefined;

  try {
    emitModule(hir, tmpObj, irPath);

    if (opts.emitIR) return;

    execSync(`clang -O2 -o ${opts.output} ${tmpObj}`, {
      stdio: "inherit",
    });
  } finally {
    try {
      unlinkSync(tmpObj);
    } catch {}
  }
}
