#!/usr/bin/env node
import { compile } from "./compiler.js";

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

  if (!input) {
    console.error("usage: chad2 build <input.ts> -o <output>");
    process.exit(1);
  }

  compile({ input, output, emitIR });
} else {
  console.error(`unknown command: ${args[0]}`);
  process.exit(1);
}
