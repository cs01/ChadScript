#!/usr/bin/env node
import { compilePhp } from "./compiler-php.js";

const args = process.argv.slice(2);

if (args.length < 1 || args[0] !== "build") {
  console.error("usage: chadphp build <input.php> -o <output>");
  process.exit(1);
}

const input = args[1];
const outputIdx = args.indexOf("-o");
const output = outputIdx !== -1 ? args[outputIdx + 1] : "a.out";
const emitIR = args.includes("--emit-ir");

if (!input) {
  console.error("usage: chadphp build <input.php> -o <output>");
  process.exit(1);
}

compilePhp({ input, output, emitIR }).catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
