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
} from "./compiler.js";
import { LogLevel, logger } from "./utils/logger.js";
import { runInit } from "./codegen/stdlib/init-templates.js";
import { ArgumentParser } from "./argparse.js";
import * as path from "path";
import * as fs from "fs";
import { execSync, spawn as spawnProc, ChildProcess } from "child_process";

const parser = new ArgumentParser("chad", "compile TypeScript to native binaries via LLVM");
parser.addSubcommand("build", "Compile to a native binary");
parser.addSubcommand("run", "Compile and run");
parser.addSubcommand("ir", "Emit LLVM IR only");
parser.addSubcommand("init", "Generate starter project (chadscript.d.ts, tsconfig.json, hello.ts)");
parser.addSubcommand("watch", "Watch for changes and recompile+run");
parser.addSubcommand("clean", "Remove the .build directory");

parser.addFlag("version", "", "Show version");
parser.addScopedOption("output", "o", "Specify output file", "", "build,run,ir");
parser.addScopedFlag("verbose", "v", "Show compilation steps", "build,run,ir,watch");
parser.addScopedFlag("debug", "", "Show internal debugging information", "build,run,ir");
parser.addScopedFlag("trace", "", "Show everything (AST, IR, variable tracking)", "build,run,ir");
parser.addScopedFlag("skip-semantic-analysis", "", "Skip semantic analysis", "build,run,ir");
parser.addScopedFlag("keep-temps", "", "Keep intermediate files (.ll, .o)", "build,run,ir");
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
parser.addPositional("input", "Input .ts or .js file");

// Node's process.argv includes [node, script, ...] — skip both.
// ChadScript's native runtime already strips argv[0], so chad-native.ts
// passes process.argv directly. Here we need slice(2).
parser.parse(process.argv.slice(2));

if (parser.getFlag("version")) {
  const packageJsonPath = path.join(import.meta.dirname || process.cwd(), "..", "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    console.log(`chad ${pkg.version}`);
  } catch {
    console.log("chad 0.1.0");
  }
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

if (command.length === 0) {
  parser.printHelp();
  process.exit(0);
}

if (
  command !== "build" &&
  command !== "run" &&
  command !== "ir" &&
  command !== "init" &&
  command !== "watch"
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

try {
  compile(inputFile, outputFile, logLevel);
} catch (error) {
  logger.error((error as Error).message);
  process.exit(1);
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
