import {
  compileNative,
  parseFileToAST,
  setSkipSemanticAnalysis,
  setEmitLLVMOnly,
  setTargetCpu,
  setTargetTriple,
  setVerbose,
  setDebugInfo,
  addLinkObj,
  addLinkLib,
  addLinkPath,
  setDiagnosticColor,
  setDiagnosticsJson,
  registerStdlib,
} from "./native-compiler-lib.js";
// d.ts content is embedded at compile time via ChadScript.embedFile
const dtsContent = ChadScript.embedFile("../chadscript.d.ts");
registerStdlib("argparse.ts", ChadScript.embedFile("../lib/argparse.ts"));
registerStdlib("http.ts", ChadScript.embedFile("../lib/http.ts"));
registerStdlib("colors.ts", ChadScript.embedFile("../lib/colors.ts"));
registerStdlib("events.ts", ChadScript.embedFile("../lib/events.ts"));
registerStdlib("glob.ts", ChadScript.embedFile("../lib/glob.ts"));
registerStdlib("compress.ts", ChadScript.embedFile("../lib/compress.ts"));
registerStdlib("postgres.ts", ChadScript.embedFile("../lib/postgres.ts"));
registerStdlib("net.ts", ChadScript.embedFile("../lib/net.ts"));
registerStdlib("tls.ts", ChadScript.embedFile("../lib/tls.ts"));
registerStdlib("pg.ts", ChadScript.embedFile("../lib/pg.ts"));
const skillContent = ChadScript.embedFile("../lib/skill.md");
import { ArgumentParser } from "chadscript/argparse";

declare const fs: {
  existsSync(filename: string): boolean;
  writeFileSync(filename: string, data: string): number;
  readdirSync(dirname: string): string[];
  unlinkSync(filename: string): number;
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
  platform: string;
  env: { [key: string]: string };
};

declare const child_process: {
  execSync(command: string): number;
};

// FFI: child-process-bridge.c — runs command with inherited stdio (output visible)
declare function cs_exec_passthrough(command: string): void;

// FFI: watch-bridge.c — polls source file and recompiles/re-runs on change
declare function cs_watch_loop(
  chad_binary: string,
  source_file: string,
  output_binary: string,
): void;

import { VERSION } from "./version.js";

const parser = new ArgumentParser("chad", "compile TypeScript to native binaries via LLVM");
// Color enabled unless NO_COLOR is set (https://no-color.org/) or TERM=dumb
const _noColor = process.env.NO_COLOR || process.env.TERM === "dumb";
const _colorEnabled = !_noColor;
parser.setColorEnabled(_colorEnabled);
setDiagnosticColor(_colorEnabled);
parser.addSubcommandInGroup("build", "Compile to a native binary", "");
parser.addSubcommandInGroup("run", "Compile and run", "");
parser.addSubcommandInGroup("watch", "Watch for changes and recompile+run", "");
parser.addSubcommandInGroup("init", "Generate starter project", "Project");
parser.addSubcommandInGroup("clean", "Remove the .build directory", "Project");
parser.addSubcommandInGroup("ir", "Emit LLVM IR only", "Advanced");
parser.addSubcommandInGroup("target", "Manage cross-compilation target SDKs", "Advanced");
parser.addSubcommandInGroup("ast-dump", "Dump parsed AST as JSON", "Advanced");

parser.addFlag("version", "", "Show version");
parser.addFlag("skill", "", "Print Claude Code skill to stdout");
parser.addScopedOption("output", "o", "Specify output file", "", "build,run,ir");
parser.addScopedFlag("verbose", "v", "Show compilation steps", "build,run,ir");
parser.addScopedFlag("debug-info", "g", "Emit DWARF debug info (skips stripping)", "build,run");
parser.addScopedFlag("skip-semantic-analysis", "", "Skip semantic analysis", "build,run,ir");
parser.addScopedOptionWithChoices(
  "diagnostics",
  "",
  "Diagnostic output format",
  "",
  "build,run,ir",
  ["json", "text"],
);
parser.addScopedOption(
  "target",
  "",
  "Cross-compile for target (only linux-x64 supported)",
  "",
  "build,run,ir",
);
parser.addScopedOption("target-cpu", "", "Set LLVM target CPU", "native", "build,run,ir");
parser.addScopedOption("link-obj", "", "Extra .o files to link (comma-separated)", "", "build,run");
parser.addScopedOption(
  "link-lib",
  "",
  "Extra libraries to link, -l flags (comma-separated)",
  "",
  "build,run",
);
parser.addScopedOption(
  "link-path",
  "",
  "Extra library paths, -L flags (comma-separated)",
  "",
  "build,run",
);
parser.addPositional("input", "Input .ts or .js file");

parser.parse(process.argv);

if (parser.getFlag("version")) {
  console.log("chad " + VERSION);
  process.exit(0);
}

if (parser.getFlag("skill")) {
  console.log(skillContent);
  process.exit(0);
}

const command = parser.getSubcommand();

if (command === "init") {
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
  const skillPath = ".claude/skills/chadscript/SKILL.md";
  if (fs.existsSync(skillPath)) {
    console.log("  skip " + skillPath + " (already exists)");
  } else {
    child_process.execSync("mkdir -p .claude/skills/chadscript");
    fs.writeFileSync(skillPath, skillContent);
    console.log("  created " + skillPath);
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

if (command === "target") {
  const action = parser.getPositional(0);
  const home = process.env.HOME;
  const baseDir = home + "/.chadscript/targets";

  if (action === "add") {
    const name = parser.getPositional(1);
    if (name.length === 0) {
      console.log("Usage: chad target add <name>");
      console.log("Example: chad target add linux-x64");
      process.exit(1);
      throw new Error("unreachable");
    }
    const sdkDir = baseDir + "/" + name;
    child_process.execSync("mkdir -p " + sdkDir);
    const url =
      "https://github.com/cs01/ChadScript/releases/download/latest/chadscript-target-" +
      name +
      ".tar.gz";
    console.log("Downloading target SDK '" + name + "'...");
    cs_exec_passthrough('curl -fsSL "' + url + '" | tar xzf - -C "' + sdkDir + '"');
    // Validate the download produced a valid SDK
    if (!fs.existsSync(sdkDir + "/sdk.json")) {
      child_process.execSync("rm -rf " + sdkDir);
      console.log("chad: error: downloaded SDK '" + name + "' is invalid (missing sdk.json)");
      process.exit(1);
      throw new Error("unreachable");
    }
    console.log("Target SDK '" + name + "' installed to " + sdkDir);
  } else if (action === "list") {
    if (!fs.existsSync(baseDir)) {
      process.exit(0);
    }
    const entries = fs.readdirSync(baseDir);
    let ei = 0;
    while (ei < entries.length) {
      if (fs.existsSync(baseDir + "/" + entries[ei] + "/sdk.json")) {
        console.log(entries[ei]);
      }
      ei = ei + 1;
    }
  } else if (action === "remove") {
    const name = parser.getPositional(1);
    if (name.length === 0) {
      console.log("Usage: chad target remove <name>");
      process.exit(1);
      throw new Error("unreachable");
    }
    const sdkDir = baseDir + "/" + name;
    if (!fs.existsSync(sdkDir)) {
      console.log("chad: target SDK '" + name + "' is not installed");
      process.exit(1);
      throw new Error("unreachable");
    }
    child_process.execSync("rm -rf " + sdkDir);
    console.log("Removed target SDK '" + name + "'");
  } else {
    console.log("Usage: chad target <action>");
    console.log("");
    console.log("Actions:");
    console.log("  add <name>      Download and install a target SDK");
    console.log("  list            List installed target SDKs");
    console.log("  remove <name>   Remove a target SDK");
    console.log("");
    console.log("Example: chad target add linux-x64");
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

if (command === "ast-dump") {
  const inputFile = parser.getPositional(0);
  if (inputFile.length === 0) {
    console.log("chad: error: no input files");
    process.exit(1);
    throw new Error("unreachable");
  }
  if (!fs.existsSync(inputFile)) {
    console.log("chad: error: file not found: " + inputFile);
    process.exit(1);
    throw new Error("unreachable");
  }
  console.log(parseFileToAST(inputFile));
  process.exit(0);
}

if (command.length === 0) {
  parser.printHelp();
  process.exit(0);
}

if (parser.getFlag("verbose")) {
  setVerbose(true);
}

if (parser.getFlag("debug-info")) {
  setDebugInfo(true);
}

if (parser.getFlag("skip-semantic-analysis")) {
  setSkipSemanticAnalysis(true);
}

const diagFormat = parser.getOption("diagnostics");
if (diagFormat === "json") {
  setDiagnosticsJson(true);
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

// Parse extra linker flags (comma-separated lists)
const linkObjOpt = parser.getOption("link-obj");
if (linkObjOpt.length > 0) {
  const parts = linkObjOpt.split(",");
  let _loi = 0;
  while (_loi < parts.length) {
    addLinkObj(parts[_loi]);
    _loi = _loi + 1;
  }
}
const linkLibOpt = parser.getOption("link-lib");
if (linkLibOpt.length > 0) {
  const parts = linkLibOpt.split(",");
  let _lli = 0;
  while (_lli < parts.length) {
    addLinkLib(parts[_lli]);
    _lli = _lli + 1;
  }
}
const linkPathOpt = parser.getOption("link-path");
if (linkPathOpt.length > 0) {
  const parts = linkPathOpt.split(",");
  let _lpi = 0;
  while (_lpi < parts.length) {
    addLinkPath(parts[_lpi]);
    _lpi = _lpi + 1;
  }
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
} else if (inputForOutput.substr(inputForOutput.length - 4) === ".tsx") {
  outputFile = ".build/" + inputForOutput.substr(0, inputForOutput.length - 4);
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
  // Use passthrough exec so stdout/stderr go directly to the terminal.
  // cs_execSync uses popen() which captures stdout into a buffer — that's
  // why `chad run` previously showed no output.
  cs_exec_passthrough(runCmd);
}
