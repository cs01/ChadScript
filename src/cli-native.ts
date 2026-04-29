import { compile } from "./compiler-native.js";

const args = process.argv.slice(1);

if (args.length < 1) {
  console.error("usage: chad2-native build <input.ts> -o <output>");
  process.exit(1);
}

if (args[0] === "build") {
  const input = args[1];
  const outputIdx = args.indexOf("-o");
  const output = outputIdx !== -1 ? args[outputIdx + 1] : "a.out";
  const emitIR = args.includes("--emit-ir");
  const llvm = args.includes("--llvm");
  const swc = args.includes("--swc");

  if (!input) {
    console.error("usage: chad2-native build <input.ts> -o <output>");
    process.exit(1);
  }

  compile({ input: input, output: output, emitIR: emitIR, llvm: llvm, swc: swc });
} else {
  console.error(`unknown command: ${args[0]}`);
  process.exit(1);
}
