#!/usr/bin/env node
import { compile } from "./compiler.js";
import { CompileError } from "./errors.js";
import { resolve } from "path";

const argv0 = process.argv[0];
const isNativeBinary = argv0 && !argv0.endsWith("node") && !argv0.includes("tsx");
const args = process.argv.slice(isNativeBinary ? 1 : 2);

if (args.length < 1) {
  console.error("usage: chad2 build <input.ts> -o <output>");
  process.exit(1);
}

if (args[0] === "build") {
  const input = args[1];
  const outputIdx = args.indexOf("-o");
  const output = outputIdx !== -1 ? args[outputIdx + 1] : "a.out";
  const emitIR = args.indexOf("--emit-ir") !== -1;
  const llvm = args.indexOf("--llvm") !== -1;
  const swc = args.indexOf("--swc") !== -1;

  const substitutions = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--substitute" && i + 1 < args.length) {
      const pair = args[i + 1];
      const eq = pair.indexOf("=");
      if (eq !== -1) {
        substitutions.set(resolve(pair.slice(0, eq)), resolve(pair.slice(eq + 1)));
      }
      i++;
    }
  }

  if (!input) {
    console.error("usage: chad2 build <input.ts> -o <output>");
    process.exit(1);
  }

  try {
    compile({ input, output, emitIR, llvm, swc, substitutions });
  } catch (e) {
    if (e instanceof CompileError) {
      console.error(e.format());
      process.exit(1);
    }
    throw e;
  }
} else {
  console.error(`unknown command: ${args[0]}`);
  process.exit(1);
}
