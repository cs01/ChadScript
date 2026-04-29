#!/usr/bin/env node
import { compile } from "./compiler.js";
import { CompileError } from "./errors.js";

const args = process.argv.slice(2);

if (args.length < 1) {
  console.error("usage: chad2 build <input.ts> -o <output>");
  process.exit(1);
}

if (args[0] === "build") {
  const input = args[1];
  const outputIdx = args.indexOf("-o");
  const output = outputIdx !== -1 ? args[outputIdx + 1] : "a.out";
  const emitIR = args.includes("--emit-ir");
  const llvm = args.includes("--llvm");

  if (!input) {
    console.error("usage: chad2 build <input.ts> -o <output>");
    process.exit(1);
  }

  try {
    compile({ input, output, emitIR, llvm });
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
