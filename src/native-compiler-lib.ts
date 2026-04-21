// Native compiler library — the self-hosted compilation path.
// This file is compiled by ChadScript itself, so it uses the native runtime
// declarations rather than Node.js imports.
import { parseSource } from "./parser-native/index.js";
import { transformTree, setCurrentFile } from "./parser-native/transformer.js";
import { LLVMGenerator, LLVMGeneratorOptions, SemaSymbolData } from "./codegen/llvm-generator.js";
import { SemanticAnalyzer } from "./analysis/semantic-analyzer.js";
import { AST, ImportDeclaration, FunctionNode, ClassNode, ClassMethod } from "./ast/types.js";
import { TargetInfo } from "./target-types.js";
import { setGlobalDiagnosticColor } from "./diagnostics/engine.js";

const stdlibKeys: string[] = [];
const stdlibValues: string[] = [];

export function registerStdlib(key: string, content: string): void {
  stdlibKeys.push(key);
  stdlibValues.push(content);
}

declare const child_process: {
  execSync(command: string): number;
};

declare const fs: {
  readFileSync(filename: string): string;
  writeFileSync(filename: string, data: string): number;
  appendFileSync(filename: string, data: string): number;
  existsSync(filename: string): boolean;
  unlinkSync(filename: string): number;
  readdirSync(dirname: string): string[];
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

declare function __gc_disable(): void;

declare function cs_llvm_compile_ir(
  ir_text: string,
  output_path: string,
  opt_level: number,
  triple: string,
  cpu: string,
  features: string,
): string;
declare function cs_llvm_compile_ir_file(
  ir_file: string,
  output_path: string,
  opt_level: number,
  triple: string,
  cpu: string,
  features: string,
): string;
declare function cs_llvm_dispose(): void;

declare function cs_lld_available(): number;
declare function cs_lld_link_macho(cmd: string): string;
declare function cs_lld_link_elf(cmd: string): string;

declare function cs_llvm_builder_init(
  name: string,
  triple: string,
  cpu: string,
  features: string,
): string;
declare function cs_llvm_builder_dispose(): void;
declare function cs_llvm_add_struct_type(name: string, field_types: string, count: number): void;
declare function cs_llvm_add_global_string(name: string, value: string, len: number): string;
declare function cs_llvm_add_function(
  name: string,
  ret_type: string,
  param_types: string,
  count: number,
): void;
declare function cs_llvm_add_extern(
  name: string,
  ret_type: string,
  param_types: string,
  count: number,
): void;
declare function cs_llvm_fn_begin(name: string): void;
declare function cs_llvm_fn_end(): void;
declare function cs_llvm_fn_set_param_name(idx: number, name: string): void;
declare function cs_llvm_bb_create(name: string): void;
declare function cs_llvm_bb_position(name: string): void;
declare function cs_llvm_build_store(type: string, value: string, ptr: string): string;
declare function cs_llvm_build_load(type: string, ptr: string): string;
declare function cs_llvm_build_gep(
  base_type: string,
  ptr: string,
  indices: string,
  count: number,
): string;
declare function cs_llvm_build_call(
  ret_type: string,
  func: string,
  args: string,
  count: number,
): string;
declare function cs_llvm_build_call_void(func: string, args: string, count: number): void;
declare function cs_llvm_build_bitcast(val: string, from_type: string, to_type: string): string;
declare function cs_llvm_build_icmp(pred: string, type: string, lhs: string, rhs: string): string;
declare function cs_llvm_build_ret(type: string, val: string): void;
declare function cs_llvm_build_ret_void(): void;
declare function cs_llvm_build_br(label: string): void;
declare function cs_llvm_build_br_cond(cond: string, then_label: string, else_label: string): void;
declare function cs_llvm_build_unreachable(): void;
declare function cs_llvm_build_alloca(type: string, name: string): string;
declare function cs_llvm_build_add(lhs: string, rhs: string): string;
declare function cs_llvm_build_sub(lhs: string, rhs: string): string;
declare function cs_llvm_build_mul(lhs: string, rhs: string): string;
declare function cs_llvm_build_fadd(lhs: string, rhs: string): string;
declare function cs_llvm_build_fsub(lhs: string, rhs: string): string;
declare function cs_llvm_build_fmul(lhs: string, rhs: string): string;
declare function cs_llvm_build_fdiv(lhs: string, rhs: string): string;
declare function cs_llvm_build_srem(lhs: string, rhs: string): string;
declare function cs_llvm_build_zext(val: string, to_type: string): string;
declare function cs_llvm_build_sext(val: string, to_type: string): string;
declare function cs_llvm_build_trunc(val: string, to_type: string): string;
declare function cs_llvm_build_sitofp(val: string, to_type: string): string;
declare function cs_llvm_build_fptosi(val: string, to_type: string): string;
declare function cs_llvm_build_ptrtoint(val: string, to_type: string): string;
declare function cs_llvm_build_inttoptr(val: string, to_type: string): string;
declare function cs_llvm_build_fcmp(pred: string, lhs: string, rhs: string): string;
declare function cs_llvm_build_phi(
  type: string,
  vals: string,
  blocks: string,
  count: number,
): string;
declare function cs_llvm_build_select(cond: string, then_val: string, else_val: string): string;
declare function cs_llvm_builder_optimize(level: number): string;
declare function cs_llvm_builder_emit_object(path: string): string;
declare function cs_llvm_builder_print(path: string): string;

function findLLVMTool(name: string): string {
  const candidates = [
    "/opt/homebrew/opt/llvm/bin/" + name,
    "/usr/local/opt/llvm/bin/" + name,
    "/opt/homebrew/opt/lld/bin/" + name,
    "/usr/local/opt/lld/bin/" + name,
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return name;
}

// Find lld for cross-linking ELF binaries. Homebrew LLVM on macOS may only
// install ld64.lld (Mach-O). Since lld is a multicall binary that uses argv[0]
// to pick its flavor, we can symlink ld64.lld as ld.lld to get ELF mode.
function findLLD(): string {
  const names = ["ld.lld", "lld"];
  for (const name of names) {
    const resolved = findLLVMTool(name);
    if (resolved !== name || fs.existsSync(name)) {
      return resolved;
    }
  }
  // ld64.lld is the same multicall binary — symlink it as ld.lld for ELF mode
  const ld64Path = findLLVMTool("ld64.lld");
  if (ld64Path !== "ld64.lld" || fs.existsSync("ld64.lld")) {
    const lldLink = "/tmp/ld.lld";
    child_process.execSync("ln -sf " + ld64Path + " " + lldLink);
    return lldLink;
  }
  return "lld";
}

function findLLVMConfig(): string {
  const candidates = [
    "/opt/homebrew/opt/llvm/bin/llvm-config",
    "/usr/local/opt/llvm/bin/llvm-config",
    "/usr/lib/llvm-21/bin/llvm-config",
    "/usr/lib/llvm-18/bin/llvm-config",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "";
}

let cachedMacSDKPath = "";
function getMacSDKPath(): string {
  if (cachedMacSDKPath.length > 0) return cachedMacSDKPath;
  const candidates = [
    "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
    "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c + "/usr/lib/libSystem.tbd")) {
      cachedMacSDKPath = c;
      return c;
    }
  }
  const tmpFile = "/tmp/cs_sdk_path.txt";
  child_process.execSync("xcrun --show-sdk-path > " + tmpFile);
  if (fs.existsSync(tmpFile)) {
    cachedMacSDKPath = fs.readFileSync(tmpFile).trim();
    fs.unlinkSync(tmpFile);
  }
  return cachedMacSDKPath;
}

function getLLDLibFlags(): string {
  const lldLibCandidates = [
    "/opt/homebrew/opt/lld/lib",
    "/usr/local/opt/lld/lib",
    "/usr/lib/llvm-21/lib",
    "/usr/lib/llvm-18/lib",
  ];
  let lldLibDir = "";
  for (const c of lldLibCandidates) {
    if (
      fs.existsSync(c + "/liblldCommon.dylib") ||
      fs.existsSync(c + "/liblldCommon.so") ||
      fs.existsSync(c + "/liblldCommon.a")
    ) {
      lldLibDir = c;
      break;
    }
  }
  if (lldLibDir.length === 0) return "";
  return "-L" + lldLibDir + " -llldMachO -llldELF -llldCommon";
}

function getLLVMLibFlags(): string {
  const cfg = findLLVMConfig();
  if (cfg.length === 0) return "";
  const tmpFile = "/tmp/cs_llvm_lib_flags.txt";
  const cmd =
    "(" +
    cfg +
    " --ldflags --libs x86 aarch64 passes core irreader --link-static && " +
    cfg +
    " --system-libs --link-static) 2>/dev/null | tr '\\n' ' ' > " +
    tmpFile;
  child_process.execSync(cmd);
  if (!fs.existsSync(tmpFile)) return "";
  const flags = fs.readFileSync(tmpFile);
  fs.unlinkSync(tmpFile);
  const isMacForLLVM = process.platform === "darwin";
  if (isMacForLLVM) {
    let result = flags + " -lc++";
    if (fs.existsSync("/opt/homebrew/opt/zstd/lib"))
      result = result + " -L/opt/homebrew/opt/zstd/lib";
    if (fs.existsSync("/usr/local/opt/zstd/lib")) result = result + " -L/usr/local/opt/zstd/lib";
    return result;
  }
  return flags + " -lstdc++";
}

export let skipSemanticAnalysis = false;
export let emitLLVMOnly = false;
export let verbose = false;
export let debugInfo = false;
export let targetCpu = "native";
export let targetTriple = "";
export let diagnosticColorEnabled = false; // set via setDiagnosticColor() by caller
// Extra linker flags from --link-obj, --link-lib, --link-path
export let extraLinkObjs: string[] = [];
export let extraLinkLibs: string[] = [];
export let extraLinkPaths: string[] = [];

export function setDiagnosticColor(value: boolean): void {
  diagnosticColorEnabled = value;
  setGlobalDiagnosticColor(value);
}

export function setDiagnosticsJson(_value: boolean): void {}

export function setSkipSemanticAnalysis(value: boolean): void {
  skipSemanticAnalysis = value;
}

export function setEmitLLVMOnly(value: boolean): void {
  emitLLVMOnly = value;
}

export function setVerbose(value: boolean): void {
  verbose = value;
}

export function setDebugInfo(value: boolean): void {
  debugInfo = value;
}

export function setTargetCpu(value: string): void {
  targetCpu = value;
}

export function setTargetTriple(value: string): void {
  targetTriple = value;
}

export function addLinkObj(objPath: string): void {
  extraLinkObjs.push(objPath);
}

export function addLinkLib(lib: string): void {
  extraLinkLibs.push(lib);
}

export function addLinkPath(libPath: string): void {
  extraLinkPaths.push(libPath);
}

// Resolve the home directory for SDK lookups
function getHomeDir(): string {
  // Use HOME env var directly — works in the native runtime
  const home = process.env.HOME;
  if (home.length > 0) return home;
  // Fallback: construct from platform + username heuristic
  if (process.platform === "darwin") {
    return "/Users/" + getUsername();
  }
  return "/home/" + getUsername();
}

function getUsername(): string {
  // process.env is available in the native runtime via dotenv bridge
  // but we can parse /etc/passwd or use a simpler approach
  // For now, use the execDir parent heuristic or fall back
  const argv0 = process.argv0;
  const dir = path.dirname(path.resolve(argv0));
  // If installed at ~/.chadscript/chad, dirname is ~/.chadscript
  if (dir.indexOf("/.chadscript") !== -1) {
    const parts = dir.substr(0, dir.indexOf("/.chadscript"));
    const lastSlash = parts.lastIndexOf("/");
    if (lastSlash !== -1) {
      return parts.substr(lastSlash + 1);
    }
  }
  // Fall back: try whoami
  return "";
}

function getSDKDir(targetName: string): string {
  const home = getHomeDir();
  if (home.length === 0) return "";
  return home + "/.chadscript/targets/" + targetName;
}

// Determine the short target name from a triple (e.g., "x86_64-unknown-linux-gnu" -> "linux-x64")
function tripleToTargetName(triple: string): string {
  const isLinux = triple.indexOf("linux") !== -1;
  const isDarwin = triple.indexOf("darwin") !== -1 || triple.indexOf("apple") !== -1;
  const isAarch64 = triple.indexOf("aarch64") !== -1 || triple.indexOf("arm64") !== -1;
  const osName = isDarwin ? "macos" : "linux";
  const archName = isAarch64 ? "arm64" : "x64";
  if (!isLinux && !isDarwin) return "";
  return osName + "-" + archName;
}

export function parseFileToAST(inputFile: string): string {
  __gc_disable();
  const absPath = path.resolve(inputFile);
  const code = fs.readFileSync(absPath);
  setCurrentFile(absPath);
  const tree = parseSource(code);
  const ast = transformTree(tree);

  // JSON.stringify(ast) doesn't work for interface-typed objects in native ChadScript —
  // it falls to the number path and treats pointers as doubles. Access fields explicitly.
  // JSON.stringify(string[]) is also unimplemented; iterate manually instead.
  let out = '{"imports":[';
  let ii = 0;
  while (ii < ast.imports.length) {
    if (ii > 0) out = out + ",";
    const imp = ast.imports[ii] as ImportDeclaration;
    let specJson = "[";
    let si = 0;
    while (si < imp.specifiers.length) {
      if (si > 0) specJson = specJson + ",";
      specJson = specJson + JSON.stringify(imp.specifiers[si]);
      si = si + 1;
    }
    specJson = specJson + "]";
    out = out + '{"source":' + JSON.stringify(imp.source) + ',"specifiers":' + specJson + "}";
    ii = ii + 1;
  }
  out = out + '],"functions":[';
  let fi = 0;
  while (fi < ast.functions.length) {
    if (fi > 0) out = out + ",";
    const fn = ast.functions[fi] as FunctionNode;
    let paramsJson = "[";
    let pi = 0;
    while (pi < fn.params.length) {
      if (pi > 0) paramsJson = paramsJson + ",";
      paramsJson = paramsJson + JSON.stringify(fn.params[pi]);
      pi = pi + 1;
    }
    paramsJson = paramsJson + "]";
    out = out + '{"name":' + JSON.stringify(fn.name) + ',"params":' + paramsJson + "}";
    fi = fi + 1;
  }
  out = out + '],"classes":[';
  let ci = 0;
  while (ci < ast.classes.length) {
    if (ci > 0) out = out + ",";
    const cls = ast.classes[ci] as ClassNode;
    let methodsJson = "[";
    let mi = 0;
    while (mi < cls.methods.length) {
      if (mi > 0) methodsJson = methodsJson + ",";
      const m = cls.methods[mi] as ClassMethod;
      methodsJson = methodsJson + JSON.stringify(m.name);
      mi = mi + 1;
    }
    methodsJson = methodsJson + "]";
    out = out + '{"name":' + JSON.stringify(cls.name) + ',"methods":' + methodsJson + "}";
    ci = ci + 1;
  }
  out = out + "]}";
  return out;
}

export function compileNative(inputFile: string, outputFile: string): void {
  const phaseStart = Date.now();
  const execDir = path.dirname(path.resolve(process.argv0));
  const installedLibDir = execDir + "/lib";
  const isInstalled = fs.existsSync(installedLibDir + "/libgc.a");
  const crossCompiling = targetTriple.length > 0;

  const BDWGC_PATH = isInstalled ? installedLibDir : "./vendor/bdwgc";
  const LWS_BRIDGE_PATH = isInstalled ? installedLibDir : "./c_bridges";
  const PICOHTTPPARSER_PATH = isInstalled ? installedLibDir : "./vendor/picohttpparser";
  const RURE_LIB_PATH = isInstalled ? installedLibDir : "./vendor/rure";
  const CHADSCRIPT_PATH = ".";

  if (verbose) {
    console.log("ChadScript native compiler v0.1.0");
    console.log("Input file: " + inputFile);
  }

  __gc_disable();

  const compiledFiles: string[] = [];
  const mergedAST = compileMultiFile(inputFile, compiledFiles);

  let semaSymbols: SemaSymbolData | undefined = undefined;
  if (skipSemanticAnalysis) {
    if (verbose) {
      console.log("Skipping semantic analysis (--skip-semantic-analysis)");
    }
  } else {
    if (verbose) {
      console.log("Running semantic analysis...");
    }
    const analyzer = new SemanticAnalyzer(mergedAST);
    analyzer.setDiagnosticColor(diagnosticColorEnabled);
    const analysisSuccess = analyzer.analyze();

    if (!analysisSuccess) {
      const errorOutput = analyzer.formatErrors();
      console.log(errorOutput);
      process.exit(1);
    }

    const semaData: SemaSymbolData = {
      names: [],
      types: [],
      llvmTypes: [],
      schemaKeys: [],
      schemaTypes: [],
    };
    for (let tsi = 0; tsi < mergedAST.topLevelStatements.length; tsi++) {
      const stmt = mergedAST.topLevelStatements[tsi];
      if (stmt.type === "variable_declaration") {
        const declName = (stmt as { name?: string }).name;
        if (declName) {
          const symType = analyzer.getSymbolTypeByName(declName);
          if (symType !== "unknown") {
            semaData.names.push(declName);
            semaData.types.push(symType);
            semaData.llvmTypes.push(analyzer.getSymbolLlvmTypeByName(declName));
            semaData.schemaKeys.push(analyzer.getSymbolSchemaKeysByName(declName));
            semaData.schemaTypes.push(analyzer.getSymbolSchemaTypesByName(declName));
          }
        }
      }
    }
    semaSymbols = semaData;
    if (verbose) {
      console.log("Semantic analysis passed");
    }
  }

  if (verbose) {
    console.log("Generating LLVM IR...");
    if (crossCompiling) {
      console.log("Cross-compiling for: " + targetTriple);
    }
  }

  // Build a TargetInfo for the LLVM generator when cross-compiling.
  // TargetInfo is imported from target-types.ts (dependency-free) so the
  // native compiler sees the interface definition and resolves correct GEP indices.
  let targetInfo: TargetInfo | undefined = undefined;
  if (crossCompiling) {
    const isDarwin = targetTriple.indexOf("darwin") !== -1 || targetTriple.indexOf("apple") !== -1;
    const isAarch64 =
      targetTriple.indexOf("aarch64") !== -1 || targetTriple.indexOf("arm64") !== -1;
    const tOs = isDarwin ? "darwin" : "linux";
    const tArch = isAarch64 ? "aarch64" : "x86_64";
    const tArchStr = isAarch64 ? "arm64" : "x64";
    // Data layout strings must match what LLVM expects
    let dl = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";
    if (isDarwin && isAarch64) {
      dl = "e-m:o-i64:64-i128:128-n32:64-S128-Fn32";
    } else if (isDarwin) {
      dl = "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";
    } else if (isAarch64) {
      dl = "e-m:e-i8:8:32-i16:16:32-i64:64-i128:128-n32:64-S128-Fn32";
    }
    targetInfo = {
      triple: targetTriple,
      os: tOs,
      arch: tArch,
      cpu: "generic",
      platformString: tOs,
      archString: tArchStr,
      dataLayout: dl,
      libc: isDarwin ? "system" : "gnu",
    };
  }

  const generatorOptions: LLVMGeneratorOptions = {
    sourceCode: "",
    filename: inputFile,
    analyzedSymbols: semaSymbols,
    target: targetInfo,
  };
  const generator = new LLVMGenerator(mergedAST, null, generatorOptions);
  generator.diagnostics.setColor(diagnosticColorEnabled);
  const irParts = generator.generateParts();
  if (verbose) {
    console.log("Generated IR parts: " + irParts.length);
  }

  let irText = "";
  for (let pi = 0; pi < irParts.length; pi++) {
    irText = irText + irParts[pi];
  }

  const irFile = outputFile + ".ll";
  fs.writeFileSync(irFile, irText);

  if (emitLLVMOnly) {
    if (verbose) {
      console.log("LLVM IR written to " + irFile);
    }
    return;
  }

  const objFile = outputFile + ".o";
  const clangTool = findLLVMTool("clang");

  const effectiveTriple = crossCompiling ? targetTriple : "";
  const effectiveCpu = crossCompiling ? "" : targetCpu;
  if (verbose) {
    console.log("Compiling IR in-memory via LLVM C API -> " + objFile);
  }
  const llvmErr = cs_llvm_compile_ir(irText, objFile, 2, effectiveTriple, effectiveCpu, "");
  if (llvmErr.length > 0) {
    console.log("Error: LLVM compilation failed: " + llvmErr);
    process.exit(1);
  }
  cs_llvm_dispose();
  if (!fs.existsSync(objFile)) {
    console.log("Error: LLVM failed to produce " + objFile);
    process.exit(1);
  }

  // Resolve SDK paths for cross-compilation
  const tgtName = crossCompiling ? tripleToTargetName(targetTriple) : "";
  const sdkDir = crossCompiling ? getSDKDir(tgtName) : "";
  const hasSDK = crossCompiling && sdkDir.length > 0 && fs.existsSync(sdkDir + "/sdk.json");

  if (crossCompiling && !hasSDK) {
    console.log("chad: error: target SDK '" + tgtName + "' not installed");
    console.log("Run: chad target add " + tgtName);
    process.exit(1);
  }

  // When cross-compiling with SDK, use SDK paths; otherwise use local/installed paths
  const sdkVendor = hasSDK ? sdkDir + "/vendor" : "";
  const sdkBridges = hasSDK ? sdkDir + "/bridges" : "";
  const sdkSysroot = hasSDK && fs.existsSync(sdkDir + "/sysroot") ? sdkDir + "/sysroot" : "";

  const effectiveGcPath = hasSDK ? sdkVendor : BDWGC_PATH;
  const effectiveBridgePath = hasSDK ? sdkBridges : LWS_BRIDGE_PATH;
  const effectivePicoPath = hasSDK ? sdkVendor : PICOHTTPPARSER_PATH;
  const effectiveRurePath = hasSDK ? sdkVendor : RURE_LIB_PATH;

  const targetIsDarwin = crossCompiling
    ? targetTriple.indexOf("darwin") !== -1
    : process.platform === "darwin";
  const isMac = process.platform === "darwin";
  const platformLibs = targetIsDarwin ? "" : " -lm -ldl -lrt -lpthread";
  // -no-pie only for native Linux builds (not when cross-compiling from macOS)
  const noPie = !targetIsDarwin && !crossCompiling ? " -no-pie" : "";
  const tsObjDir = isInstalled ? installedLibDir : CHADSCRIPT_PATH + "/build";
  let treeSitterObjs = "";
  let tsLibPath = "";
  if (generator.getUsesTreeSitter()) {
    if (hasSDK) {
      const sdkTsParser = sdkVendor + "/tree-sitter-typescript-parser.o";
      const sdkTsScanner = sdkVendor + "/tree-sitter-typescript-scanner.o";
      const sdkTsBridge = sdkBridges + "/treesitter-bridge.o";
      if (fs.existsSync(sdkTsParser)) {
        treeSitterObjs = sdkTsParser + " " + sdkTsScanner + " " + sdkTsBridge;
      }
      tsLibPath = sdkVendor + "/libtree-sitter.a";
    } else {
      treeSitterObjs =
        tsObjDir +
        "/tree-sitter-typescript-parser.o " +
        tsObjDir +
        "/tree-sitter-typescript-scanner.o " +
        tsObjDir +
        "/treesitter-bridge.o";
      tsLibPath = isInstalled
        ? installedLibDir + "/libtree-sitter.a"
        : "./vendor/tree-sitter/libtree-sitter.a";
    }
  }
  let linkLibs = "-L" + effectiveGcPath + " -lgc" + platformLibs;
  if (tsLibPath) {
    linkLibs = linkLibs + " " + tsLibPath;
  }
  const yyjsonDir = hasSDK ? sdkVendor : isInstalled ? installedLibDir : "./vendor/yyjson";
  if (generator.getUsesJson()) {
    linkLibs = "-L" + yyjsonDir + " -lyyjson " + linkLibs;
  }
  const uvDir = hasSDK ? sdkVendor : isInstalled ? installedLibDir : "./vendor/libuv/build";
  if (
    generator.getUsesTimers() ||
    generator.getUsesPromises() ||
    generator.getUsesCurl() ||
    generator.getUsesUvHrtime() ||
    generator.getUsesHttpServer()
  ) {
    linkLibs = "-L" + uvDir + " -luv " + linkLibs;
  }
  if (generator.getUsesCurl()) {
    linkLibs = "-lcurl " + linkLibs;
  }
  if (generator.getUsesCrypto()) {
    linkLibs = "-lcrypto " + linkLibs;
  }
  if (generator.getUsesSqlite()) {
    linkLibs = "-lsqlite3 " + linkLibs;
  }
  let usesPostgres: boolean = false;
  let usesNet: boolean = false;
  let usesTls: boolean = false;
  for (let i = 0; i < generator.declaredExternFunctions.length; i++) {
    const fn = generator.declaredExternFunctions[i];
    if (fn.startsWith("cs_pg_")) {
      usesPostgres = true;
    } else if (fn.startsWith("cs_net_")) {
      usesNet = true;
    } else if (fn.startsWith("cs_tls_")) {
      usesNet = true;
      usesTls = true;
    }
  }
  // net-bridge.o references OpenSSL symbols unconditionally (TLS is inline
  // with the plain path, gated at runtime on s->ssl != NULL). Any program
  // that links net-bridge must also link libssl + libcrypto.
  if (usesNet) {
    linkLibs = "-lssl -lcrypto " + linkLibs;
  }
  if (usesPostgres) {
    linkLibs = "-lpq " + linkLibs;
  }
  // net-bridge needs libuv. Add it if not already pulled in by a prior use.
  if (
    usesNet &&
    !(
      generator.getUsesTimers() ||
      generator.getUsesPromises() ||
      generator.getUsesCurl() ||
      generator.getUsesUvHrtime() ||
      generator.getUsesHttpServer()
    )
  ) {
    linkLibs = "-L" + uvDir + " -luv " + linkLibs;
  }
  if (generator.getUsesHttpServer()) {
    linkLibs = "-lz -lzstd " + linkLibs;
  }
  if (generator.getUsesCompression() && !generator.getUsesHttpServer()) {
    linkLibs = "-lz -lzstd " + linkLibs;
  }
  if (generator.getUsesRegex()) {
    // librure: static archive built from Rust's `regex` crate (rure C ABI).
    // On macOS pulls in Security + CoreFoundation transitively (rustc
    // default for darwin); Linux needs no extras beyond libpthread/libdl.
    linkLibs = effectiveRurePath + "/librure.a " + linkLibs;
    if (targetIsDarwin) {
      linkLibs = "-framework Security -framework CoreFoundation " + linkLibs;
    }
  }
  const lwsBridgeObj = generator.getUsesHttpServer()
    ? effectiveBridgePath +
      "/lws-bridge.o " +
      effectivePicoPath +
      "/picohttpparser.o " +
      effectiveBridgePath +
      "/multipart-bridge.o"
    : "";
  const regexBridgeObj = generator.getUsesRegex() ? effectiveBridgePath + "/regex-bridge.o" : "";
  const cpBridgeObj = generator.getUsesChildProcess()
    ? effectiveBridgePath + "/child-process-bridge.o"
    : "";
  const osBridgeObj = effectiveBridgePath + "/os-bridge.o";
  const stringOpsBridgeObj = effectiveBridgePath + "/string-ops-bridge.o";
  const strlenCacheObj = effectiveBridgePath + "/strlen-cache.o";
  const timeBridgeObj = effectiveBridgePath + "/time-bridge.o";
  const base64BridgeObj = effectiveBridgePath + "/base64-bridge.o";
  const urlBridgeObj = effectiveBridgePath + "/url-bridge.o";
  const uriBridgeObj = effectiveBridgePath + "/uri-bridge.o";
  const dotenvBridgePath = effectiveBridgePath + "/dotenv-bridge.o";
  const dotenvBridgeObj = fs.existsSync(dotenvBridgePath) ? dotenvBridgePath : "";
  const watchBridgeObj = effectiveBridgePath + "/watch-bridge.o";
  const arenaBridgeObj = effectiveBridgePath + "/arena-bridge.o";
  const trampBridgeObj = effectiveBridgePath + "/trampoline-bridge.o";
  const cpSpawnObj = generator.getUsesSpawn() ? effectiveBridgePath + "/child-process-spawn.o" : "";
  const curlBridgeObj = generator.getUsesCurl() ? effectiveBridgePath + "/curl-bridge.o" : "";
  const pgBridgeObj = usesPostgres ? effectiveBridgePath + "/pg-bridge.o" : "";
  const netBridgeObj = usesNet ? effectiveBridgePath + "/net-bridge.o" : "";
  const scramBridgeObj = usesNet ? effectiveBridgePath + "/scram-bridge.o" : "";
  const compressBridgeObj = generator.getUsesCompression()
    ? effectiveBridgePath + "/compress-bridge.o"
    : "";
  const yamlBridgeObj = generator.getUsesYaml() ? effectiveBridgePath + "/yaml-bridge.o" : "";
  let llvmBridgeObj = "";
  let llvmBuilderObj = "";
  let lldBridgeObj = "";
  if (generator.getUsesLLVM()) {
    const llvmBridgePath = effectiveBridgePath + "/llvm-bridge.o";
    if (fs.existsSync(llvmBridgePath)) {
      llvmBridgeObj = llvmBridgePath;
    }
    const llvmBuilderPath = effectiveBridgePath + "/llvm-builder-bridge.o";
    if (fs.existsSync(llvmBuilderPath)) {
      llvmBuilderObj = llvmBuilderPath;
    }
    const llvmLibResult = getLLVMLibFlags();
    if (llvmLibResult.length > 0) {
      linkLibs = linkLibs + " " + llvmLibResult;
    }
  }
  if (generator.getUsesLLD()) {
    const lldBridgePath = effectiveBridgePath + "/lld-bridge.o";
    if (fs.existsSync(lldBridgePath)) {
      lldBridgeObj = lldBridgePath;
    }
    const lldLibResult = getLLDLibFlags();
    if (lldLibResult.length > 0) {
      linkLibs = lldLibResult + " " + linkLibs;
    }
  }

  let allObjs =
    objFile +
    " " +
    lwsBridgeObj +
    " " +
    regexBridgeObj +
    " " +
    cpBridgeObj +
    " " +
    osBridgeObj +
    " " +
    strlenCacheObj +
    " " +
    timeBridgeObj +
    " " +
    base64BridgeObj +
    " " +
    urlBridgeObj +
    " " +
    uriBridgeObj +
    " " +
    dotenvBridgeObj +
    " " +
    watchBridgeObj +
    " " +
    arenaBridgeObj +
    " " +
    trampBridgeObj +
    " " +
    cpSpawnObj +
    " " +
    curlBridgeObj +
    " " +
    pgBridgeObj +
    " " +
    netBridgeObj +
    " " +
    scramBridgeObj +
    " " +
    compressBridgeObj +
    " " +
    yamlBridgeObj +
    " " +
    stringOpsBridgeObj +
    " " +
    llvmBridgeObj +
    " " +
    llvmBuilderObj +
    " " +
    lldBridgeObj +
    " " +
    treeSitterObjs;

  let userLinkObjs = "";
  for (let _oi = 0; _oi < extraLinkObjs.length; _oi++) {
    userLinkObjs = userLinkObjs + " " + extraLinkObjs[_oi];
  }
  let userLinkFlags = "";
  for (let _pi = 0; _pi < extraLinkPaths.length; _pi++) {
    userLinkFlags = userLinkFlags + " -L" + extraLinkPaths[_pi];
  }
  for (let _li = 0; _li < extraLinkLibs.length; _li++) {
    userLinkFlags = userLinkFlags + " -l" + extraLinkLibs[_li];
  }
  allObjs = allObjs + userLinkObjs;
  linkLibs = linkLibs + userLinkFlags;

  const useLLD = cs_lld_available() > 0 && !crossCompiling;

  if (useLLD) {
    let filtered = "";
    let idx = 0;
    while (idx < linkLibs.length) {
      while (idx < linkLibs.length && linkLibs.charAt(idx) === " ") idx = idx + 1;
      let end = idx;
      while (end < linkLibs.length && linkLibs.charAt(end) !== " ") end = end + 1;
      const tok = linkLibs.substr(idx, end - idx);
      if (tok.length > 0 && tok.substr(0, 4) !== "-Wl,") {
        if (filtered.length > 0) filtered = filtered + " ";
        filtered = filtered + tok;
      }
      idx = end;
    }
    linkLibs = filtered;
  }

  if (useLLD && targetIsDarwin) {
    if (!crossCompiling && isMac) {
      if (generator.getUsesCrypto() || usesNet) {
        if (fs.existsSync("/opt/homebrew/opt/openssl/lib"))
          linkLibs = "-L/opt/homebrew/opt/openssl/lib " + linkLibs;
        if (fs.existsSync("/usr/local/opt/openssl/lib"))
          linkLibs = "-L/usr/local/opt/openssl/lib " + linkLibs;
      }
      if (generator.getUsesSqlite()) {
        if (fs.existsSync("/opt/homebrew/opt/sqlite/lib"))
          linkLibs = "-L/opt/homebrew/opt/sqlite/lib " + linkLibs;
        if (fs.existsSync("/usr/local/opt/sqlite/lib"))
          linkLibs = "-L/usr/local/opt/sqlite/lib " + linkLibs;
      }
      if (usesPostgres) {
        if (fs.existsSync("/opt/homebrew/opt/libpq/lib"))
          linkLibs = "-L/opt/homebrew/opt/libpq/lib " + linkLibs;
        if (fs.existsSync("/usr/local/opt/libpq/lib"))
          linkLibs = "-L/usr/local/opt/libpq/lib " + linkLibs;
      }
      if (generator.getUsesHttpServer() || generator.getUsesCompression()) {
        if (fs.existsSync("/opt/homebrew/opt/zstd/lib"))
          linkLibs = "-L/opt/homebrew/opt/zstd/lib " + linkLibs;
        if (fs.existsSync("/usr/local/opt/zstd/lib"))
          linkLibs = "-L/usr/local/opt/zstd/lib " + linkLibs;
      }
      if (fs.existsSync("/usr/local/lib")) linkLibs = "-L/usr/local/lib " + linkLibs;
    }
    const sdkPath = getMacSDKPath();

    const lldCmd =
      allObjs +
      " -o " +
      outputFile +
      " -arch arm64" +
      " -platform_version macos 11.0.0 0" +
      " -syslibroot " +
      sdkPath +
      " -lSystem " +
      linkLibs;
    if (verbose) {
      console.log("LLD macho: " + lldCmd);
    }
    const lldErr = cs_lld_link_macho(lldCmd);
    if (lldErr.length > 0) {
      console.log("Error: LLD linking failed: " + lldErr);
      process.exit(1);
    }
  } else if (useLLD && !targetIsDarwin) {
    const shouldStatic = crossCompiling;
    let lldCmd = allObjs + " -o " + outputFile + " --no-pie";
    if (shouldStatic) lldCmd = lldCmd + " -static";
    if (!debugInfo) lldCmd = lldCmd + " --strip-all";
    if (hasSDK && sdkSysroot.length > 0) {
      lldCmd = lldCmd + " --sysroot=" + sdkSysroot;
    }
    const crtPaths = ["/usr/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib"];
    let crtDir = "";
    for (const cp of crtPaths) {
      if (fs.existsSync(cp + "/crt1.o")) {
        crtDir = cp;
        break;
      }
    }
    if (crtDir.length > 0) {
      lldCmd = crtDir + "/crt1.o " + crtDir + "/crti.o " + lldCmd + " " + crtDir + "/crtn.o";
    }
    lldCmd = lldCmd + " -lc " + linkLibs;
    if (!shouldStatic) {
      lldCmd = lldCmd + " --dynamic-linker /lib64/ld-linux-x86-64.so.2";
    }
    if (verbose) {
      console.log("LLD elf: " + lldCmd);
    }
    const lldErr = cs_lld_link_elf(lldCmd);
    if (lldErr.length > 0) {
      console.log("Error: LLD linking failed: " + lldErr);
      process.exit(1);
    }
  } else {
    if (hasSDK && sdkSysroot.length > 0) {
      linkLibs = "--sysroot=" + sdkSysroot + " " + linkLibs;
    } else if (!crossCompiling && isMac) {
      if (generator.getUsesCrypto() || usesNet) {
        if (fs.existsSync("/opt/homebrew/opt/openssl/lib"))
          linkLibs = "-L/opt/homebrew/opt/openssl/lib " + linkLibs;
        if (fs.existsSync("/usr/local/opt/openssl/lib"))
          linkLibs = "-L/usr/local/opt/openssl/lib " + linkLibs;
      }
      if (generator.getUsesSqlite()) {
        if (fs.existsSync("/opt/homebrew/opt/sqlite/lib"))
          linkLibs = "-L/opt/homebrew/opt/sqlite/lib " + linkLibs;
        if (fs.existsSync("/usr/local/opt/sqlite/lib"))
          linkLibs = "-L/usr/local/opt/sqlite/lib " + linkLibs;
      }
      if (usesPostgres) {
        if (fs.existsSync("/opt/homebrew/opt/libpq/lib"))
          linkLibs = "-L/opt/homebrew/opt/libpq/lib " + linkLibs;
        if (fs.existsSync("/usr/local/opt/libpq/lib"))
          linkLibs = "-L/usr/local/opt/libpq/lib " + linkLibs;
      }
      if (generator.getUsesHttpServer() || generator.getUsesCompression()) {
        if (fs.existsSync("/opt/homebrew/opt/zstd/lib"))
          linkLibs = "-L/opt/homebrew/opt/zstd/lib " + linkLibs;
        if (fs.existsSync("/usr/local/opt/zstd/lib"))
          linkLibs = "-L/usr/local/opt/zstd/lib " + linkLibs;
      }
      let macLinkPrefix = "-Wl,-syslibroot,$(xcrun --show-sdk-path)";
      if (fs.existsSync("/usr/local/lib")) macLinkPrefix = macLinkPrefix + " -L/usr/local/lib";
      linkLibs = macLinkPrefix + " " + linkLibs;
    }
    const shouldStatic = !targetIsDarwin && crossCompiling;
    const staticFlag = shouldStatic ? " -static" : "";
    const crossTargetFlag = crossCompiling ? " --target=" + targetTriple : "";
    const debugFlag = debugInfo ? " -g" : "";
    const stripFlag = !debugInfo && !isMac ? " -s" : "";
    const crossLinker = crossCompiling ? " -fuse-ld=" + findLLD() : "";
    const suppressLdWarnings = isMac ? " -Wl,-w" : "";
    const noPieFlag = !targetIsDarwin && !crossCompiling ? " -no-pie" : "";
    const linkCmd =
      clangTool +
      " " +
      allObjs +
      " -o " +
      outputFile +
      noPieFlag +
      debugFlag +
      stripFlag +
      staticFlag +
      crossTargetFlag +
      crossLinker +
      suppressLdWarnings +
      " " +
      linkLibs;
    if (verbose) {
      console.log("Running: " + linkCmd);
    }
    child_process.execSync(linkCmd);
  }

  if (!fs.existsSync(outputFile)) {
    console.log("Error: linker failed to produce " + outputFile);
    process.exit(1);
  }

  fs.unlinkSync(objFile);
  if (verbose) {
    console.log("Compiled: " + outputFile + " in " + (Date.now() - phaseStart) + "ms");
  }
}

export function compileMultiFile(entryFile: string, compiledFiles: string[]): AST {
  const absPath = path.resolve(entryFile);

  for (let i = 0; i < compiledFiles.length; i++) {
    if (compiledFiles[i] === absPath) {
      return emptyAST();
    }
  }
  compiledFiles.push(absPath);

  if (verbose) {
    console.log("Parsing: " + absPath);
  }
  const STDLIB_PREFIX = "/CHADSCRIPT_STDLIB/";
  let code = "";
  if (absPath.substr(0, STDLIB_PREFIX.length) === STDLIB_PREFIX) {
    const key = absPath.substr(STDLIB_PREFIX.length);
    let found = false;
    for (let si = 0; si < stdlibKeys.length; si++) {
      if (stdlibKeys[si] === key) {
        code = stdlibValues[si];
        found = true;
        break;
      }
    }
    if (!found) {
      console.log("stdlib module not found: " + key);
      process.exit(1);
    }
  } else {
    code = fs.readFileSync(absPath);
  }
  setCurrentFile(absPath);
  const tree = parseSource(code);
  const ast = transformTree(tree);

  const mergedAST: AST = {
    imports: [],
    functions: ast.functions.slice(0),
    classes: ast.classes.slice(0),
    exports: ast.exports.slice(0),
    interfaces: ast.interfaces.slice(0),
    typeAliases: ast.typeAliases ? ast.typeAliases.slice(0) : [],
    enums: ast.enums ? ast.enums.slice(0) : [],
    defaultExportName: ast.defaultExportName,
    topLevelStatements: ast.topLevelStatements.slice(0),
    topLevelExpressions: ast.topLevelExpressions.slice(0),
    topLevelItems: ast.topLevelItems ? ast.topLevelItems.slice(0) : [],
    topLevelItemTypes: ast.topLevelItemTypes ? ast.topLevelItemTypes.slice(0) : [],
    importAliasNames: [],
    importAliasOriginals: [],
  };

  let i = 0;
  while (i < ast.imports.length) {
    const imp = ast.imports[i] as ImportDeclaration;
    const src = imp.source;

    const isRelative =
      src.substr(0, 2) === "./" || src.substr(0, 3) === "../" || src.substr(0, 1) === "/";

    if (!isRelative) {
      const builtins = ["fs", "path", "child_process"];
      let isBuiltin = false;
      for (let j = 0; j < builtins.length; j++) {
        if (builtins[j] === src) {
          isBuiltin = true;
        }
      }
      if (isBuiltin) {
        i = i + 1;
        continue;
      }
      if (src.substr(0, 11) === "chadscript/") {
        const stdlibName = src.substr(11);
        const virtualPath = "/CHADSCRIPT_STDLIB/" + stdlibName + ".ts";
        const importedAST = compileMultiFile(virtualPath, compiledFiles);
        mergedAST.functions = mergedAST.functions.concat(importedAST.functions);
        mergedAST.classes = mergedAST.classes.concat(importedAST.classes);
        mergedAST.interfaces = mergedAST.interfaces.concat(importedAST.interfaces);
        mergedAST.typeAliases = mergedAST.typeAliases.concat(importedAST.typeAliases);
        mergedAST.enums = mergedAST.enums.concat(importedAST.enums);
        mergedAST.topLevelStatements = importedAST.topLevelStatements.concat(
          mergedAST.topLevelStatements,
        );
        if (importedAST.topLevelItems) {
          mergedAST.topLevelItems = importedAST.topLevelItems.concat(mergedAST.topLevelItems || []);
        }
        if (importedAST.topLevelItemTypes) {
          mergedAST.topLevelItemTypes = importedAST.topLevelItemTypes.concat(
            mergedAST.topLevelItemTypes || [],
          );
        }
        i = i + 1;
        continue;
      }
      console.log("Cannot compile npm package: " + src);
      process.exit(1);
    }

    const importPath = resolveImportPath(absPath, src);
    const importedAST = compileMultiFile(importPath, compiledFiles);

    mergedAST.functions = mergedAST.functions.concat(importedAST.functions);
    mergedAST.classes = mergedAST.classes.concat(importedAST.classes);
    mergedAST.interfaces = mergedAST.interfaces.concat(importedAST.interfaces);
    mergedAST.typeAliases = mergedAST.typeAliases.concat(importedAST.typeAliases);
    mergedAST.enums = mergedAST.enums.concat(importedAST.enums);
    mergedAST.topLevelStatements = importedAST.topLevelStatements.concat(
      mergedAST.topLevelStatements,
    );
    if (importedAST.topLevelItems) {
      mergedAST.topLevelItems = importedAST.topLevelItems.concat(mergedAST.topLevelItems || []);
    }
    if (importedAST.topLevelItemTypes) {
      mergedAST.topLevelItemTypes = importedAST.topLevelItemTypes.concat(
        mergedAST.topLevelItemTypes || [],
      );
    }
    i = i + 1;
  }

  return mergedAST;
}

export function resolveImportPath(fromFile: string, importSource: string): string {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir + "/" + importSource);

  // Prefer .ts/.tsx source over compiled .js
  if (importSource.substr(importSource.length - 3) === ".js") {
    const tsPath = resolved.substr(0, resolved.length - 3) + ".ts";
    if (fs.existsSync(tsPath)) {
      return tsPath;
    }
    const tsxPath = resolved.substr(0, resolved.length - 3) + ".tsx";
    if (fs.existsSync(tsxPath)) {
      return tsxPath;
    }
  }

  if (fs.existsSync(resolved)) {
    return resolved;
  }

  if (fs.existsSync(resolved + ".ts")) {
    return resolved + ".ts";
  }

  if (fs.existsSync(resolved + ".tsx")) {
    return resolved + ".tsx";
  }

  if (fs.existsSync(resolved + ".js")) {
    return resolved + ".js";
  }

  console.log("Cannot resolve import: " + importSource + " from " + fromFile);
  process.exit(1);
  return "";
}

export function emptyAST(): AST {
  return {
    imports: [],
    functions: [],
    classes: [],
    exports: [],
    interfaces: [],
    typeAliases: [],
    enums: [],
    defaultExportName: undefined,
    topLevelStatements: [],
    topLevelExpressions: [],
    topLevelItems: [],
    topLevelItemTypes: [],
    importAliasNames: [],
    importAliasOriginals: [],
  };
}
