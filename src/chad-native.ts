import {
  compileNative,
  setSkipSemanticAnalysis,
  setEmitLLVMOnly,
  setTargetCpu,
  setTargetTriple,
  setVerbose,
} from "./native-compiler-lib.js";
import { getDtsContent } from "./codegen/stdlib/embedded-dts.js";
import { ArgumentParser } from "./argparse.js";

declare const fs: {
  existsSync(filename: string): boolean;
  writeFileSync(filename: string, data: string): number;
};

declare const path: {
  resolve(p: string): string;
  dirname(p: string): string;
  basename(p: string): string;
};

declare const process: {
  exit(code: number): void;
  argv: string[];
  argv0: string;
};

declare const child_process: {
  execSync(command: string): number;
};

// FFI: watch-bridge.c — polls source file and recompiles/re-runs on change
declare function cs_watch_loop(
  chad_binary: string,
  source_file: string,
  output_binary: string,
): void;

const VERSION = "0.1.0";

const parser = new ArgumentParser("chad", "compile TypeScript to native binaries via LLVM");
parser.addSubcommand("build", "Compile to a native binary");
parser.addSubcommand("run", "Compile and run");
parser.addSubcommand("ir", "Emit LLVM IR only");
parser.addSubcommand("init", "Generate starter project");
parser.addSubcommand("watch", "Watch for changes and recompile+run");
parser.addSubcommand("clean", "Remove the .build directory");

parser.addFlag("version", "", "Show version");
parser.addScopedOption("output", "o", "Specify output file", "", "build,run,ir");
parser.addScopedFlag("verbose", "v", "Show compilation steps", "build,run,ir");
parser.addScopedFlag("skip-semantic-analysis", "", "Skip semantic analysis", "build,run,ir");
parser.addScopedOption(
  "target",
  "",
  "Cross-compile for target (only linux-x64 supported)",
  "",
  "build,run,ir",
);
parser.addScopedOption("target-cpu", "", "Set LLVM target CPU", "native", "build,run,ir");
parser.addPositional("input", "Input .ts or .js file");

parser.parse(process.argv);

if (parser.getFlag("version")) {
  console.log("chad " + VERSION);
  process.exit(0);
}

const command = parser.getSubcommand();

if (command === "init") {
  const dtsContent = getDtsContent();
  if (fs.existsSync("chadscript.d.ts")) {
    console.log("  skip chadscript.d.ts (already exists)");
  } else {
    fs.writeFileSync("chadscript.d.ts", dtsContent);
    console.log("  created chadscript.d.ts");
  }
  if (fs.existsSync("tsconfig.json")) {
    console.log("  skip tsconfig.json (already exists)");
  } else {
    fs.writeFileSync(
      "tsconfig.json",
      '{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "ES2020",\n    "lib": ["ES2020"],\n    "noEmit": true,\n    "skipLibCheck": true,\n    "strict": true\n  }\n}\n',
    );
    console.log("  created tsconfig.json");
  }
  if (fs.existsSync("hello.ts")) {
    console.log("  skip hello.ts (already exists)");
  } else {
    fs.writeFileSync("hello.ts", 'console.log("Hello from ChadScript!");\nprocess.exit(0);\n');
    console.log("  created hello.ts");
  }
  console.log("");
  console.log("Ready!");
  console.log("");
  console.log("  Try: chad run hello.ts");
  process.exit(0);
}

if (command === "clean") {
  if (fs.existsSync(".build")) {
    child_process.execSync("rm -rf .build");
    console.log("removed .build");
  }
  process.exit(0);
}

if (command === "watch") {
  const watchInput = parser.getPositional(0);
  if (watchInput.length === 0) {
    console.log("chad: error: no input files");
    console.log("Usage: chad watch <input.ts>");
    process.exit(1);
    throw new Error("unreachable");
  }
  if (!fs.existsSync(watchInput)) {
    console.log("chad: error: file not found: " + watchInput);
    process.exit(1);
    throw new Error("unreachable");
  }
  // Compute output path (same logic as build)
  let watchBase: string = watchInput;
  if (watchBase.substr(0, 1) === "/") {
    watchBase = path.basename(watchBase);
  }
  let watchOutput: string = ".build/" + watchBase;
  if (watchBase.substr(watchBase.length - 3) === ".ts") {
    watchOutput = ".build/" + watchBase.substr(0, watchBase.length - 3);
  } else if (watchBase.substr(watchBase.length - 3) === ".js") {
    watchOutput = ".build/" + watchBase.substr(0, watchBase.length - 3);
  }
  const watchOutDir = path.dirname(watchOutput);
  if (!fs.existsSync(watchOutDir)) {
    child_process.execSync("mkdir -p " + watchOutDir);
  }
  // Resolve the chad binary path for recompilation
  const chadBin = process.argv0;
  cs_watch_loop(chadBin, watchInput, watchOutput);
  process.exit(0);
}

if (command.length === 0) {
  parser.printHelp();
  process.exit(0);
}

if (parser.getFlag("verbose")) {
  setVerbose(true);
}

if (parser.getFlag("skip-semantic-analysis")) {
  setSkipSemanticAnalysis(true);
}

// Cross-compilation: only linux-x64 for build/run (needs SDK + linker).
// IR generation can target any platform since it only emits LLVM IR.
const targetOpt = parser.getOption("target");
if (targetOpt.length > 0) {
  if (command !== "ir" && targetOpt !== "linux-x64") {
    console.log("chad: error: cross-compilation only supports 'linux-x64' as a target");
    process.exit(1);
    throw new Error("unreachable");
  }
  // Map short names to LLVM triples
  let triple = targetOpt;
  if (targetOpt === "linux-x64") triple = "x86_64-unknown-linux-gnu";
  else if (targetOpt === "macos-arm64") triple = "aarch64-apple-darwin";
  else if (targetOpt === "macos-x64") triple = "x86_64-apple-darwin";
  setTargetTriple(triple);
}

const cpuOpt = parser.getOption("target-cpu");
if (cpuOpt.length > 0) {
  setTargetCpu(cpuOpt);
}

const inputFile = parser.getPositional(0);
if (inputFile.length === 0) {
  console.log("chad: error: no input files");
  console.log("Usage: chad " + command + " [options] <input.ts>");
  process.exit(1);
  throw new Error("unreachable");
}

if (!fs.existsSync(inputFile)) {
  console.log("chad: error: file not found: " + inputFile);
  process.exit(1);
  throw new Error("unreachable");
}

let inputForOutput: string = inputFile;
if (inputForOutput.substr(0, 1) === "/") {
  inputForOutput = path.basename(inputForOutput);
}
let outputFile: string = ".build/" + inputForOutput;
const explicitOutput = parser.getOption("output");
if (explicitOutput.length > 0) {
  outputFile = explicitOutput;
} else if (inputForOutput.substr(inputForOutput.length - 3) === ".ts") {
  outputFile = ".build/" + inputForOutput.substr(0, inputForOutput.length - 3);
} else if (inputForOutput.substr(inputForOutput.length - 3) === ".js") {
  outputFile = ".build/" + inputForOutput.substr(0, inputForOutput.length - 3);
}

const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
  child_process.execSync("mkdir -p " + outputDir);
}

if (command === "ir") {
  setEmitLLVMOnly(true);
}

compileNative(inputFile, outputFile);

if (command === "run") {
  const binPath = path.resolve(outputFile);
  if (!fs.existsSync(binPath)) {
    console.log("chad: error: compilation produced no binary");
    process.exit(1);
  }
  const rest = parser.getRestArgs();
  let runCmd = binPath;
  let ri = 0;
  while (ri < rest.length) {
    runCmd = runCmd + " " + rest[ri];
    ri = ri + 1;
  }
  child_process.execSync(runCmd);
}
