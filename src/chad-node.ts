#!/usr/bin/env node

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
import {
  getSDKBaseDir,
  getSDKDownloadURL,
  listInstalledSDKs,
  hasTargetSDK,
} from "./cross-compile.js";
import { getHostTarget, resolveTarget, targetName } from "./target.js";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execSync, spawn as spawnProc, ChildProcess } from "child_process";

const args = process.argv.slice(2);

// Cross-compilation target SDK management (list, add, remove)
function handleTargetCommand(targetArgs: string[]): void {
  const sub = targetArgs[0] || "list";

  if (sub === "list") {
    const host = getHostTarget();
    console.log(`Host: ${targetName(host)} (${host.triple})`);
    console.log("");
    const installed = listInstalledSDKs();
    if (installed.length === 0) {
      console.log("No target SDKs installed.");
      console.log("");
      console.log("Install one with: chad target add linux-x64");
    } else {
      console.log("Installed target SDKs:");
      for (const name of installed) {
        const metaPath = path.join(getSDKBaseDir(), name, "sdk.json");
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          console.log(`  ${name}  (${meta.triple}, libc: ${meta.libc})`);
        } catch {
          console.log(`  ${name}`);
        }
      }
    }
    return;
  }

  if (sub === "add") {
    const name = targetArgs[1];
    if (!name) {
      console.error("Usage: chad target add <name>");
      console.error("Available targets: linux-x64, linux-arm64, macos-arm64, macos-x64");
      process.exit(1);
    }

    // Validate the target name
    try {
      resolveTarget(name);
    } catch {
      console.error(`chad: error: unknown target '${name}'`);
      console.error("Available targets: linux-x64, linux-arm64, macos-arm64, macos-x64");
      process.exit(1);
    }

    // macOS targets can't be redistributed from Linux (Apple license)
    const host = getHostTarget();
    if (name.startsWith("macos") && host.os !== "darwin") {
      console.error("chad: error: macOS target SDKs cannot be downloaded on non-macOS hosts");
      console.error("Apple's license prohibits redistributing macOS SDK files.");
      console.error("");
      console.error("To cross-compile for macOS from Linux, use osxcross:");
      console.error("  https://github.com/tpoechtrager/osxcross");
      process.exit(1);
    }

    const sdkDir = path.join(getSDKBaseDir(), name);
    if (fs.existsSync(path.join(sdkDir, "sdk.json"))) {
      console.log(`Target SDK '${name}' is already installed at ${sdkDir}`);
      return;
    }

    const url = getSDKDownloadURL(name);
    console.log(`Downloading target SDK: ${name}`);
    console.log(`  from: ${url}`);

    // Download and extract
    const tmpFile = path.join(os.tmpdir(), `chadscript-target-${name}.tar.gz`);
    try {
      execSync(`curl -fSL "${url}" -o "${tmpFile}"`, { stdio: "inherit" });
    } catch {
      console.error(`chad: error: failed to download SDK from ${url}`);
      console.error("Check your internet connection or verify the release exists.");
      process.exit(1);
    }

    fs.mkdirSync(sdkDir, { recursive: true });
    try {
      execSync(`tar -xzf "${tmpFile}" -C "${sdkDir}"`, { stdio: "inherit" });
    } catch {
      console.error("chad: error: failed to extract SDK tarball");
      fs.rmSync(sdkDir, { recursive: true });
      process.exit(1);
    }

    // Clean up temp file
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }

    if (!fs.existsSync(path.join(sdkDir, "sdk.json"))) {
      console.error("chad: error: SDK tarball did not contain sdk.json");
      fs.rmSync(sdkDir, { recursive: true });
      process.exit(1);
    }

    console.log(`Target SDK '${name}' installed at ${sdkDir}`);
    return;
  }

  if (sub === "remove") {
    const name = targetArgs[1];
    if (!name) {
      console.error("Usage: chad target remove <name>");
      process.exit(1);
    }
    const sdkDir = path.join(getSDKBaseDir(), name);
    if (!fs.existsSync(sdkDir)) {
      console.log(`Target SDK '${name}' is not installed.`);
      return;
    }
    fs.rmSync(sdkDir, { recursive: true });
    console.log(`Removed target SDK '${name}'`);
    return;
  }

  console.error(`chad: error: unknown target subcommand '${sub}'`);
  console.error("Usage: chad target [list|add|remove] [name]");
  process.exit(1);
}

function printVersion(): void {
  const packageJsonPath = path.join(import.meta.dirname || process.cwd(), "..", "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    console.log(`chad ${pkg.version}`);
  } catch {
    console.log("chad 0.1.0");
  }
}

function printHelp(): void {
  console.log("chad - compile TypeScript to native binaries via LLVM");
  console.log("");
  console.log("Usage: chad <command> [options] <file>");
  console.log("");
  console.log("Commands:");
  console.log("  build <file>     Compile to a native binary");
  console.log("  run <file>       Compile and run");
  console.log("  ir <file>        Emit LLVM IR only");
  console.log(
    "  init             Generate starter project (chadscript.d.ts, tsconfig.json, hello.ts)",
  );
  console.log("  watch <file>     Watch for changes and recompile+run");
  console.log("  clean            Remove the .build directory");
  console.log("  target           Manage cross-compilation target SDKs");
  console.log("");
  console.log("Options:");
  console.log("  -o <output>                 Specify output file");
  console.log("  -v, --verbose               Show compilation steps");
  console.log("  --debug                     Show internal debugging information");
  console.log("  --trace                     Show everything (AST, IR, variable tracking)");
  console.log("  --skip-semantic-analysis    Skip semantic analysis");
  console.log("  --keep-temps                Keep intermediate files (.ll, .o)");
  console.log("  -fsanitize=address          Build with AddressSanitizer");
  console.log("  -g                          Emit DWARF debug info for source-level debugging");
  console.log(
    "  --target <triple>           Cross-compile for target (e.g., macos-arm64, linux-x64)",
  );
  console.log("  --target-cpu <cpu>          Set LLVM target CPU (default: native)");
  console.log("  --static                    Link statically");
  console.log("  -h, --help                  Show this help message");
  console.log("  --version                   Show version");
  console.log("");
  console.log("Cross-compilation:");
  console.log("  chad target list            Show installed target SDKs");
  console.log("  chad target add <name>      Download a target SDK (e.g., linux-x64)");
  console.log("  chad target remove <name>   Remove an installed target SDK");
  console.log("");
  console.log("Examples:");
  console.log("  chad build hello.ts");
  console.log("  chad build hello.ts -o myapp");
  console.log("  chad run hello.ts");
  console.log("  chad run hello.ts -- arg1 arg2");
  console.log("  chad ir hello.ts");
  console.log("  chad build --target linux-x64 hello.ts -o hello-linux");
}

if (args.length === 0) {
  printHelp();
  process.exit(0);
}

const command = args[0];

if (command === "-h" || command === "--help") {
  printHelp();
  process.exit(0);
}

if (command === "--version") {
  printVersion();
  process.exit(0);
}

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
  handleTargetCommand(args.slice(1));
  process.exit(0);
}

if (command === "watch") {
  const watchFile = args[1];
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
  const dashIdx = args.indexOf("--");
  const runArgs = dashIdx >= 0 ? args.slice(dashIdx + 1) : [];

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

if (
  command !== "build" &&
  command !== "run" &&
  command !== "ir" &&
  command !== "init" &&
  command !== "watch" &&
  command !== "target"
) {
  if (command.endsWith(".ts") || command.endsWith(".js")) {
    console.error(`chad: error: missing command. did you mean 'chad build ${command}'?`);
  } else {
    console.error(`chad: error: unknown command '${command}'`);
  }
  console.error("Run chad --help for usage");
  process.exit(1);
}

const subArgs = args.slice(1);
let logLevel = LogLevel.Normal;
const fileArgs: string[] = [];
let skipNextArg = false;
let outputArg: string | null = null;
let dashdashIndex = -1;

for (let i = 0; i < subArgs.length; i++) {
  const arg = subArgs[i];
  if (skipNextArg) {
    skipNextArg = false;
    continue;
  }
  if (arg === "--") {
    dashdashIndex = i;
    break;
  }
  if (arg === "-v" || arg === "--verbose") {
    logLevel = LogLevel.Verbose;
  } else if (arg === "--debug") {
    logLevel = LogLevel.Debug;
  } else if (arg === "--trace") {
    logLevel = LogLevel.Trace;
  } else if (arg === "--skip-semantic-analysis") {
    setSkipSemanticAnalysis(true);
  } else if (arg === "--keep-temps" || arg === "-save-temps") {
    setKeepTemps(true);
  } else if (arg === "-fsanitize=address" || arg === "--sanitize=address") {
    setSanitize("address");
  } else if (arg === "-g") {
    setDebugInfo(true);
  } else if (arg === "--target") {
    if (i + 1 < subArgs.length) {
      setTarget(subArgs[i + 1]);
      skipNextArg = true;
    }
  } else if (arg.startsWith("--target-cpu=")) {
    setTargetCpu(arg.split("=")[1]);
  } else if (arg === "--target-cpu") {
    if (i + 1 < subArgs.length) {
      setTargetCpu(subArgs[i + 1]);
      skipNextArg = true;
    }
  } else if (arg === "--static") {
    setStaticLink(true);
  } else if (arg === "-o") {
    if (i + 1 < subArgs.length) {
      outputArg = subArgs[i + 1];
      skipNextArg = true;
    }
  } else if (arg === "-h" || arg === "--help") {
    printHelp();
    process.exit(0);
  } else {
    fileArgs.push(arg);
  }
}

const runArgs = dashdashIndex >= 0 ? subArgs.slice(dashdashIndex + 1) : [];

if (command === "ir") {
  setEmitLLVMOnly(true);
  setKeepTemps(true);
}

if (fileArgs.length < 1) {
  console.error("chad: error: no input files");
  console.error(`Usage: chad ${command} [options] <input.ts|.js>`);
  process.exit(1);
}

const inputFile = fileArgs[0];

const defaultOutput = path.join(".build", inputFile.replace(/\.(js|ts)$/, ""));
const outputFile = outputArg || fileArgs[1] || defaultOutput;

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
    const runCmd = [bin, ...runArgs].map((a) => `"${a}"`).join(" ");
    execSync(runCmd, { stdio: "inherit" });
  } catch (error) {
    const err = error as { status?: number };
    process.exit(err.status ?? 1);
  }
}
