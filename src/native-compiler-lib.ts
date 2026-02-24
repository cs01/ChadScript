// Native compiler library — the self-hosted compilation path.
// This file is compiled by ChadScript itself, so it uses the native runtime
// declarations rather than Node.js imports.
import { parseSource } from "./parser-native/index.js";
import { transformTree } from "./parser-native/transformer.js";
import { LLVMGenerator, LLVMGeneratorOptions, SemaSymbolData } from "./codegen/llvm-generator.js";
import { SemanticAnalyzer } from "./analysis/semantic-analyzer.js";
import { AST, ImportDeclaration } from "./ast/types.js";
import { TargetInfo } from "./target-types.js";

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

export let skipSemanticAnalysis = false;
export let emitLLVMOnly = false;
export let verbose = false;
export let targetCpu = "native";
export let targetTriple = "";
// Extra linker flags from --link-obj, --link-lib, --link-path
export let extraLinkObjs: string[] = [];
export let extraLinkLibs: string[] = [];
export let extraLinkPaths: string[] = [];

export function setSkipSemanticAnalysis(value: boolean): void {
  skipSemanticAnalysis = value;
}

export function setEmitLLVMOnly(value: boolean): void {
  emitLLVMOnly = value;
}

export function setVerbose(value: boolean): void {
  verbose = value;
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

export function compileNative(inputFile: string, outputFile: string): void {
  const execDir = path.dirname(path.resolve(process.argv0));
  const installedLibDir = execDir + "/lib";
  const isInstalled = fs.existsSync(installedLibDir + "/libgc.a");
  const crossCompiling = targetTriple.length > 0;

  const BDWGC_PATH = isInstalled ? installedLibDir : "./vendor/bdwgc";
  const LWS_BRIDGE_PATH = isInstalled ? installedLibDir : "./c_bridges";
  const PICOHTTPPARSER_PATH = isInstalled ? installedLibDir : "./vendor/picohttpparser";
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
  const irParts = generator.generateParts();
  if (verbose) {
    console.log("Generated IR parts: " + irParts.length);
  }

  const irFile = outputFile + ".ll";
  fs.writeFileSync(irFile, "");
  for (let pi = 0; pi < irParts.length; pi++) {
    const part = irParts[pi];
    if (verbose && part.indexOf("ts_parser_language") !== -1) {
      const preview = part.substr(0, 80);
      console.log(
        "Part " + pi + " contains ts_parser_language, len=" + part.length + " preview=" + preview,
      );
    }
    fs.appendFileSync(irFile, part);
  }

  if (emitLLVMOnly) {
    if (verbose) {
      console.log("LLVM IR written to " + irFile);
    }
    return;
  }

  const objFile = outputFile + ".o";
  const optFile = irFile.replace(".ll", ".opt.bc");
  const optTool = findLLVMTool("opt");
  const llcTool = findLLVMTool("llc");
  const clangTool = findLLVMTool("clang");

  // Cross-compilation: add triple flags to opt/llc
  const cpuFlag = crossCompiling ? "-mcpu=generic" : "-mcpu=" + targetCpu;
  const tripleFlag = crossCompiling ? " -mtriple=" + targetTriple : "";

  const optCmd = optTool + " -O2 " + cpuFlag + tripleFlag + " " + irFile + " -o " + optFile;
  if (verbose) {
    console.log("Running: " + optCmd);
  }
  child_process.execSync(optCmd);
  const llcCmd =
    llcTool + " -O2 " + cpuFlag + tripleFlag + " -filetype=obj " + optFile + " -o " + objFile;
  if (verbose) {
    console.log("Running: " + llcCmd);
  }
  child_process.execSync(llcCmd);
  if (!fs.existsSync(objFile)) {
    console.log("Error: llc failed to produce " + objFile);
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
    generator.getUsesMongoose()
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
  if (generator.getUsesMongoose()) {
    linkLibs = "-lz -lzstd " + linkLibs;
  }
  const lwsBridgeObj = generator.getUsesMongoose()
    ? effectiveBridgePath +
      "/lws-bridge.o " +
      effectivePicoPath +
      "/picohttpparser.o " +
      effectiveBridgePath +
      "/multipart-bridge.o"
    : "";
  const regexBridgeObj = generator.getUsesRegex() ? effectiveBridgePath + "/regex-bridge.o" : "";
  const cpBridgeObj = effectiveBridgePath + "/child-process-bridge.o";
  const osBridgeObj = effectiveBridgePath + "/os-bridge.o";
  const dotenvBridgePath = effectiveBridgePath + "/dotenv-bridge.o";
  const dotenvBridgeObj = fs.existsSync(dotenvBridgePath) ? dotenvBridgePath : "";
  const watchBridgeObj = effectiveBridgePath + "/watch-bridge.o";
  const cpSpawnObj = generator.getUsesSpawn() ? effectiveBridgePath + "/child-process-spawn.o" : "";

  // Sysroot and target flags for cross-compilation
  if (hasSDK && sdkSysroot.length > 0) {
    linkLibs = "--sysroot=" + sdkSysroot + " " + linkLibs;
  } else if (!crossCompiling && isMac) {
    // Only add -L flags for paths that actually exist to avoid ld warnings.
    // Both prefixes are checked because we can't detect arch at runtime in native code.
    if (generator.getUsesCrypto()) {
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
    if (generator.getUsesMongoose()) {
      if (fs.existsSync("/opt/homebrew/opt/zstd/lib"))
        linkLibs = "-L/opt/homebrew/opt/zstd/lib " + linkLibs;
      if (fs.existsSync("/usr/local/opt/zstd/lib"))
        linkLibs = "-L/usr/local/opt/zstd/lib " + linkLibs;
    }
    let macLinkPrefix = "-Wl,-syslibroot,$(xcrun --show-sdk-path)";
    if (fs.existsSync("/usr/local/lib")) macLinkPrefix = macLinkPrefix + " -L/usr/local/lib";
    linkLibs = macLinkPrefix + " " + linkLibs;
  }

  // Cross-compiled Linux binaries must link statically — the SDK sysroot only
  // has .a archives (Ubuntu's .so files are linker scripts with hardcoded paths).
  const shouldStatic = !targetIsDarwin && crossCompiling;
  const staticFlag = shouldStatic ? " -static" : "";
  const crossTargetFlag = crossCompiling ? " --target=" + targetTriple : "";
  // Cross-compiling requires lld — the host linker can't produce foreign binaries.
  // Use full path because Homebrew clang can't find lld by short name.
  // Try ld.lld first (ELF-specific), fall back to lld (multicall binary, auto-detects format).
  const crossLinker = crossCompiling ? " -fuse-ld=" + findLLD() : "";

  // User-provided linker flags (--link-obj, --link-lib, --link-path)
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

  const linkCmd =
    clangTool +
    " " +
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
    dotenvBridgeObj +
    " " +
    watchBridgeObj +
    " " +
    cpSpawnObj +
    " " +
    treeSitterObjs +
    userLinkObjs +
    " -o " +
    outputFile +
    noPie +
    staticFlag +
    crossTargetFlag +
    crossLinker +
    " " +
    linkLibs +
    userLinkFlags;
  if (verbose) {
    console.log("Running: " + linkCmd);
  }
  child_process.execSync(linkCmd);
  if (!fs.existsSync(outputFile)) {
    console.log("Error: clang failed to produce " + outputFile);
    process.exit(1);
  }

  fs.unlinkSync(objFile);
  if (verbose) {
    console.log("Compiled: " + outputFile);
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
  const code = fs.readFileSync(absPath);
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
