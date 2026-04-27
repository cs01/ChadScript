import { parseFile } from "./parser.js";
import { lowerModule } from "./hir/lower.js";
import { emitModule } from "./codegen/emitter.js";
import { writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

export interface CompileOptions {
  input: string;
  output: string;
  emitIR?: boolean;
}

export function compile(opts: CompileOptions): void {
  const ast = parseFile(opts.input);
  const hir = lowerModule(ast);
  const ir = emitModule(hir);

  if (opts.emitIR) {
    writeFileSync(opts.output + ".ll", ir);
    return;
  }

  const tmpIR = join(tmpdir(), `chad2-${process.pid}.ll`);
  writeFileSync(tmpIR, ir);

  try {
    execSync(`clang -O2 -o ${opts.output} ${tmpIR}`, {
      stdio: "inherit",
    });
  } finally {
    try {
      unlinkSync(tmpIR);
    } catch {}
  }
}
