#!/usr/bin/env node
// Node.js CLI entry point for ChadScript.
// Uses the shared argparse library for argument parsing (same as the native binary).

import {
  compile,
  setSkipSemanticAnalysis,
  setKeepTemps,
  setEmitLLVMOnly,
  setSanitize,
  setDebugInfo,
  setTarget,
  setTargetCpu,
  setStaticLink,
  setDiagnosticsJson,
  addLinkObj,
  addLinkLib,
  addLinkPath,
} from "./compiler.js";
import { LogLevel, logger } from "./utils/logger.js";
import { runInit } from "./codegen/stdlib/init-templates.js";
import { ArgumentParser } from "./argparse.js";
import { parseWithTSAPI } from "./parser-ts/index.js";
import * as path from "path";
import * as fs from "fs";
import { execSync, spawn as spawnProc, ChildProcess } from "child_process";
import { installTargetSDK, listInstalledSDKs, getSDKBaseDir } from "./cross-compile.js";
import { VERSION } from "./version.js";

const parser = new ArgumentParser("chad", "compile TypeScript to native binaries via LLVM");
parser.setColorEnabled(process.stdout.isTTY === true);
parser.addSubcommandInGroup("build", "Compile to a native binary", "");
parser.addSubcommandInGroup("run", "Compile and run", "");
parser.addSubcommandInGroup("watch", "Watch for changes and recompile+run", "");
parser.addSubcommandInGroup(
  "init",
  "Generate starter project (chadscript.d.ts, tsconfig.json, hello.ts)",
  "Project",
);
parser.addSubcommandInGroup("clean", "Remove the .build directory", "Project");
parser.addSubcommandInGroup("ir", "Emit LLVM IR only", "Advanced");
parser.addSubcommandInGroup("target", "Manage cross-compilation target SDKs", "Advanced");
parser.addSubcommandInGroup("ast-dump", "Dump parsed AST as JSON", "Advanced");

parser.addFlag("version", "", "Show version");
parser.addFlag("skill", "", "Print Claude Code skill to stdout");
parser.addScopedOption("output", "o", "Specify output file", "", "build,run,ir");
parser.addScopedFlag("verbose", "v", "Show compilation steps", "build,run,ir,watch");
parser.addScopedFlag("debug", "", "Show internal debugging information", "build,run,ir");
parser.addScopedFlag("trace", "", "Show everything (AST, IR, variable tracking)", "build,run,ir");
parser.addScopedFlag("skip-semantic-analysis", "", "Skip semantic analysis", "build,run,ir");
parser.addScopedFlag("keep-temps", "", "Keep intermediate files (.ll, .o)", "build,run,ir");
parser.addScopedOptionWithChoices(
  "diagnostics",
  "",
  "Diagnostic output format",
  "",
  "build,run,ir",
  ["json", "text"],
);
parser.addScopedFlag("sanitize-address", "", "Build with AddressSanitizer", "build,run");
parser.addScopedFlag("debug-info", "g", "Emit DWARF debug info", "build,run");
parser.addScopedOption(
  "target",
  "",
  "Cross-compile for target (only linux-x64 supported)",
  "",
  "build,run,ir",
);
parser.addScopedOption(
  "target-cpu",
  "",
  "Set LLVM target CPU (default: native)",
  "",
  "build,run,ir",
);
parser.addScopedFlag("static", "", "Link statically", "build,run");
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

// Node's process.argv includes [node, script, ...] — skip both.
// ChadScript's native runtime already strips argv[0], so chad-native.ts
// passes process.argv directly. Here we need slice(2).
parser.parse(process.argv.slice(2));

if (parser.getFlag("version")) {
  console.log(`chad ${VERSION}`);
  process.exit(0);
}

if (parser.getFlag("skill")) {
  const skillPath = path.join(import.meta.dirname || process.cwd(), "../lib/skill.md");
  process.stdout.write(fs.readFileSync(skillPath, "utf8"));
  process.exit(0);
}

const command = parser.getSubcommand();

if (command === "init") {
  runInit();
  process.exit(0);
}

if (command === "clean") {
  const buildDir = path.resolve(".build");
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true });
    console.log("removed .build");
  }
  process.exit(0);
}

if (command === "target") {
  const action = parser.getPositional(0);

  if (action === "add") {
    const name = parser.getPositional(1);
    if (!name) {
      console.error("Usage: chad target add <name>");
      console.error("Example: chad target add linux-x64");
      process.exit(1);
    }
    installTargetSDK(name);
  } else if (action === "list") {
    const sdks = listInstalledSDKs();
    for (const sdk of sdks) {
      console.log(sdk);
    }
  } else if (action === "remove") {
    const name = parser.getPositional(1);
    if (!name) {
      console.error("Usage: chad target remove <name>");
      process.exit(1);
    }
    const sdkDir = path.join(getSDKBaseDir(), name);
    if (!fs.existsSync(sdkDir)) {
      console.error(`chad: target SDK '${name}' is not installed`);
      process.exit(1);
    }
    fs.rmSync(sdkDir, { recursive: true });
    console.log(`Removed target SDK '${name}'`);
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
  const watchFile = parser.getPositional(0);
  if (!watchFile) {
    console.error("chad: error: no input files");
    console.error("Usage: chad watch <input.ts>");
    process.exit(1);
  }
  if (!fs.existsSync(watchFile)) {
    console.error(`chad: error: file not found: ${watchFile}`);
    process.exit(1);
  }
  // Node-hosted watch: use the native chad binary if available, otherwise node compiler
  const chadBin = fs.existsSync(".build/chad") ? ".build/chad" : `node ${process.argv[1]}`;
  const outBase = watchFile.replace(/\.(ts|js)$/, "");
  const outputBin = `.build/${outBase}`;
  const outputDir2 = path.dirname(outputBin);
  if (!fs.existsSync(outputDir2)) {
    fs.mkdirSync(outputDir2, { recursive: true });
  }

  const EXCLUDED_DIRS = new Set([".build", "node_modules", "vendor", ".git", "dist"]);
  // Build artifacts we should never trigger a rebuild for
  const EXCLUDED_EXTS = new Set([".o", ".ll", ".bc", ".a", ".so", ".dylib"]);
  const watchDir = path.dirname(path.resolve(watchFile));
  // Collect -- args to pass through to the spawned binary
  const runArgs = parser.getRestArgs();

  let childProc: ChildProcess | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const killChild = () => {
    if (childProc) {
      childProc.kill("SIGTERM");
      childProc = null;
    }
  };

  const buildAndRun = () => {
    killChild();
    console.log("\x1b[2J\x1b[H"); // clear screen
    console.log(`[watch] compiling ${watchFile}...`);
    try {
      execSync(`${chadBin} build ${watchFile} -o ${outputBin}`, { stdio: "inherit" });
    } catch {
      console.log("[watch] compile failed, waiting for changes...");
      return;
    }
    console.log(`[watch] running ${outputBin}\n`);
    childProc = spawnProc(path.resolve(outputBin), runArgs, { stdio: "inherit" });
    childProc.on("exit", () => {
      childProc = null;
    });
  };

  process.on("SIGINT", () => {
    killChild();
    console.log("\n[watch] stopped");
    process.exit(0);
  });

  // Initial compile+run
  buildAndRun();

  // fs.watch with recursive:true uses inotify/kqueue under the hood —
  // much more efficient than the old fs.watchFile polling approach
  console.log(`[watch] watching ${watchDir}`);
  fs.watch(watchDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    // Skip excluded directories
    const parts = filename.split(path.sep);
    for (const part of parts) {
      if (EXCLUDED_DIRS.has(part)) return;
    }
    // Skip build artifacts — rebuild on everything else (.ts, .js, .css, .html, etc.)
    const ext = path.extname(filename);
    if (EXCLUDED_EXTS.has(ext)) return;
    // 50ms debounce — editors often fire multiple events per save
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      buildAndRun();
    }, 50);
  });
}

if (command === "ast-dump") {
  const inputFile = parser.getPositional(0);
  if (!inputFile) {
    console.error("chad: error: no input files");
    process.exit(1);
  }
  if (!fs.existsSync(inputFile)) {
    console.error(`chad: error: file not found: ${inputFile}`);
    process.exit(1);
  }
  const code = fs.readFileSync(inputFile, "utf8");
  const ast = parseWithTSAPI(code, { filename: inputFile });
  process.stdout.write(JSON.stringify(ast) + "\n");
  process.exit(0);
}

if (command.length === 0) {
  parser.printHelp();
  process.exit(0);
}

if (
  command !== "build" &&
  command !== "run" &&
  command !== "ir" &&
  command !== "init" &&
  command !== "watch" &&
  command !== "target" &&
  command !== "ast-dump"
) {
  if (command.endsWith(".ts") || command.endsWith(".js")) {
    console.error(`chad: error: missing command. did you mean 'chad build ${command}'?`);
  } else {
    console.error(`chad: error: unknown command '${command}'`);
  }
  console.error("Run chad --help for usage");
  process.exit(1);
}

// Configure compiler options from parsed flags
let logLevel = LogLevel.Normal;
if (parser.getFlag("verbose")) logLevel = LogLevel.Verbose;
if (parser.getFlag("debug")) logLevel = LogLevel.Debug;
if (parser.getFlag("trace")) logLevel = LogLevel.Trace;

if (parser.getFlag("skip-semantic-analysis")) setSkipSemanticAnalysis(true);
if (parser.getFlag("keep-temps")) setKeepTemps(true);
const diagFormat = parser.getOption("diagnostics");
if (diagFormat === "json") setDiagnosticsJson(true);
if (parser.getFlag("sanitize-address")) setSanitize("address");
if (parser.getFlag("debug-info")) setDebugInfo(true);
if (parser.getFlag("static")) setStaticLink(true);

// Cross-compilation: only linux-x64 is supported for build/run (needs SDK + linker).
// IR generation (chad ir) can target any platform since it only emits LLVM IR.
const targetOpt = parser.getOption("target");
if (targetOpt) {
  if (command !== "ir" && targetOpt !== "linux-x64") {
    console.error("chad: error: cross-compilation only supports 'linux-x64' as a target");
    process.exit(1);
  }
  setTarget(targetOpt);
}

const cpuOpt = parser.getOption("target-cpu");
if (cpuOpt) setTargetCpu(cpuOpt);

// Parse extra linker flags (comma-separated lists)
const linkObjOpt = parser.getOption("link-obj");
if (linkObjOpt) linkObjOpt.split(",").forEach((o) => addLinkObj(o));
const linkLibOpt = parser.getOption("link-lib");
if (linkLibOpt) linkLibOpt.split(",").forEach((l) => addLinkLib(l));
const linkPathOpt = parser.getOption("link-path");
if (linkPathOpt) linkPathOpt.split(",").forEach((p) => addLinkPath(p));

if (command === "ir") {
  setEmitLLVMOnly(true);
  setKeepTemps(true);
}

const inputFile = parser.getPositional(0);
if (!inputFile) {
  console.error("chad: error: no input files");
  console.error(`Usage: chad ${command} [options] <input.ts|.js>`);
  process.exit(1);
}

const explicitOutput = parser.getOption("output");
const defaultOutput = path.join(".build", inputFile.replace(/\.(js|ts)$/, ""));
const outputFile = explicitOutput || defaultOutput;

const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

if (diagFormat === "json") {
  let stderrCapture = "";
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrCapture += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  const origExit = process.exit.bind(process);
  (process as { exit: (code?: number) => never }).exit = ((code?: number) => {
    process.stderr.write = origWrite;
    if (code !== 0 && stderrCapture.length > 0) {
      const msg = stderrCapture.replace(/\x1b\[[0-9;]*m/g, "").trim();
      process.stdout.write(
        '{"diagnostics":[{"severity":"error","message":' +
          JSON.stringify(msg) +
          '}],"success":false}\n',
      );
    }
    origExit(code);
  }) as typeof process.exit;
  try {
    compile(inputFile, outputFile, logLevel);
    process.stderr.write = origWrite;
    process.exit = origExit;
  } catch (error) {
    process.stderr.write = origWrite;
    process.exit = origExit;
    const msg =
      stderrCapture.length > 0
        ? stderrCapture.replace(/\x1b\[[0-9;]*m/g, "").trim()
        : (error as Error).message;
    process.stdout.write(
      '{"diagnostics":[{"severity":"error","message":' +
        JSON.stringify(msg) +
        '}],"success":false}\n',
    );
    process.exit(1);
  }
} else {
  try {
    compile(inputFile, outputFile, logLevel);
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }
}

if (command === "run") {
  const bin = path.resolve(outputFile);
  if (!fs.existsSync(bin)) {
    logger.error("chad: error: compilation produced no binary");
    process.exit(1);
  }
  try {
    const runArgs = parser.getRestArgs();
    const runCmd = [bin, ...runArgs].map((a) => `"${a}"`).join(" ");
    execSync(runCmd, { stdio: "inherit" });
  } catch (error) {
    const err = error as { status?: number };
    process.exit(err.status ?? 1);
  }
}
