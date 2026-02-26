import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { parseWithTSAPI } from "./parser-ts/index.js";
import { LLVMGenerator, LLVMGeneratorOptions, SemaSymbolData } from "./codegen/llvm-generator.js";
import { TypeChecker } from "./typescript/type-checker.js";
import { SemanticAnalyzer, TypedSymbol } from "./analysis/semantic-analyzer.js";
import { AST, ImportDeclaration, ClassNode, FunctionNode } from "./ast/types.js";
import { LogLevel, logger } from "./utils/logger.js";
import { TargetInfo, resolveTarget, getHostTarget, isCrossCompiling } from "./target.js";
import { loadTargetSDK, ensureTargetSDK, TargetSDK } from "./cross-compile.js";

function findLLVMTool(name: string): string {
  const candidates = [
    "/opt/homebrew/opt/llvm/bin/" + name,
    "/usr/local/opt/llvm/bin/" + name,
    "/opt/homebrew/opt/lld/bin/" + name,
    "/usr/local/opt/lld/bin/" + name,
  ];
  try {
    return execSync("which " + name, { stdio: "pipe", encoding: "utf8" }).trim();
  } catch (e) {
    // bare name not in PATH — check Homebrew locations
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "chad: error: " +
      name +
      " not found\n" +
      "Install LLVM:\n" +
      "  macOS: brew install llvm\n" +
      "  Ubuntu/Debian: sudo apt-get install llvm clang\n" +
      "  Fedora: sudo dnf install llvm clang",
  );
}

// Find lld for cross-linking ELF binaries. Homebrew LLVM on macOS may only
// install ld64.lld (Mach-O). Since lld is a multicall binary that uses argv[0]
// to pick its flavor, we can symlink ld64.lld as ld.lld to get ELF mode.
function findLLD(): string {
  try {
    return findLLVMTool("ld.lld");
  } catch {}
  try {
    return findLLVMTool("lld");
  } catch {}
  // ld64.lld is the same multicall binary — symlink it as ld.lld for ELF mode
  try {
    const ld64Path = findLLVMTool("ld64.lld");
    const lldLink = "/tmp/ld.lld";
    try {
      fs.unlinkSync(lldLink);
    } catch {}
    fs.symlinkSync(ld64Path, lldLink);
    return lldLink;
  } catch {}
  throw new Error(
    "chad: error: lld not found (needed for cross-compilation)\n" +
      "Install lld:\n" +
      "  macOS: brew install lld\n" +
      "  Ubuntu/Debian: sudo apt-get install lld\n" +
      "  Fedora: sudo dnf install lld",
  );
}

let skipSemanticAnalysis = false;
let keepTemps = false;
let emitLLVMOnly = false;
let sanitize: string | null = null;
let debugInfo = false;
let staticLink = false;
let targetCpu = "native";
let targetOverride: TargetInfo | null = null;
// Extra linker flags from --link-obj, --link-lib, --link-path
let extraLinkObjs: string[] = [];
let extraLinkLibs: string[] = [];
let extraLinkPaths: string[] = [];
// Defaults to true when stderr is a real terminal; can be overridden
let diagnosticColorEnabled: boolean = process.stderr.isTTY === true;

export function setDiagnosticColor(enabled: boolean): void {
  diagnosticColorEnabled = enabled;
}

export function setTargetCpu(value: string): void {
  targetCpu = value;
}

export function setSkipSemanticAnalysis(value: boolean): void {
  skipSemanticAnalysis = value;
}

export function setKeepTemps(value: boolean): void {
  keepTemps = value;
}

export function setEmitLLVMOnly(value: boolean): void {
  emitLLVMOnly = value;
}

export function setSanitize(value: string): void {
  sanitize = value;
}

export function setDebugInfo(value: boolean): void {
  debugInfo = value;
}

export function setStaticLink(value: boolean): void {
  staticLink = value;
}

export function setTarget(value: string): void {
  targetOverride = resolveTarget(value);
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

// External library paths - check env vars, then use vendor/
const BDWGC_PATH = process.env.CHADSCRIPT_BDWGC_PATH || "./vendor/bdwgc";
const LWS_BRIDGE_PATH = process.env.CHADSCRIPT_LWS_BRIDGE_PATH || "./c_bridges";
const PICOHTTPPARSER_PATH = process.env.CHADSCRIPT_PICOHTTPPARSER_PATH || "./vendor/picohttpparser";
const YYJSON_PATH = process.env.CHADSCRIPT_YYJSON_PATH || "./vendor/yyjson";
const LIBUV_PATH = process.env.CHADSCRIPT_LIBUV_PATH || "./vendor/libuv/build";
const TREESITTER_LIB_PATH = process.env.CHADSCRIPT_TREESITTER_PATH || "./vendor/tree-sitter";
// TSX grammar is a strict superset of TypeScript — all .ts code parses identically.
// The only difference: <Type>expr angle-bracket assertions become JSX, but ChadScript
// uses `as Type` so there's no impact on existing code.
const TREESITTER_TS_PATH = "node_modules/tree-sitter-typescript/tsx/src";

// ============================================
// MAIN COMPILER DRIVER
// ============================================

export function compile(
  inputFile: string,
  outputFile: string,
  logLevel: LogLevel = LogLevel.Normal,
): void {
  // Set the global logger level
  logger.setLevel(logLevel);

  const target = targetOverride || getHostTarget();
  const crossCompiling = isCrossCompiling(target);

  // Get version from package.json
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const version = packageJson.version;

  logger.info(`ChadScript compiler version ${version}`);
  logger.info(`Target: ${target.archString}-${target.platformString}`);
  if (crossCompiling) {
    logger.info(`Cross-compiling for ${target.triple}`);
  }
  logger.info(`InstalledDir: ${process.cwd()}`);

  // Check for required build tools
  const llcPath = findLLVMTool("llc");
  const optPath = findLLVMTool("opt");
  let linkerPath: string;
  let useClang = true;

  try {
    linkerPath = findLLVMTool("clang");
  } catch (error) {
    try {
      linkerPath = execSync("which gcc", { stdio: "pipe", encoding: "utf8" }).trim();
      useClang = false;
    } catch (gccError) {
      throw new Error(
        "chad: error: clang or gcc not found in PATH\n" +
          "Install a C compiler:\n" +
          "  macOS: xcode-select --install\n" +
          "  Ubuntu/Debian: sudo apt-get install clang\n" +
          "  RHEL/Fedora: sudo yum install clang",
      );
    }
  }

  // Parse all files (starting from entry point, following imports)
  const compiledFiles: string[] = [];
  const fileContentKeys: string[] = [];
  const fileContentValues: string[] = [];
  const mergedAST = compileMultiFile(
    inputFile,
    compiledFiles,
    fileContentKeys,
    fileContentValues,
    inputFile,
  );

  // Run semantic analysis to catch type errors early (unless skipped)
  let analyzedSymbols: SemaSymbolData | undefined = undefined;
  if (!skipSemanticAnalysis) {
    logger.info("Running semantic analysis...");
    const analyzer = new SemanticAnalyzer(mergedAST);
    analyzer.setDiagnosticColor(diagnosticColorEnabled);
    const analysisSuccess = analyzer.analyze();

    if (!analysisSuccess) {
      const errorOutput = analyzer.formatErrors();
      console.error(errorOutput);
      throw new Error("Semantic analysis failed. Fix the errors above and try again.");
    } else {
      const diagOutput = analyzer.formatErrors();
      if (diagOutput) {
        console.error(diagOutput);
      }
    }

    const symMap = analyzer.getSymbols();
    const semaData: SemaSymbolData = {
      names: [],
      types: [],
      llvmTypes: [],
      schemaKeys: [],
      schemaTypes: [],
    };
    symMap.forEach((sym: TypedSymbol, _k: string) => {
      semaData.names.push(sym.name);
      semaData.types.push(sym.type);
      semaData.llvmTypes.push(sym.llvmType);
      semaData.schemaKeys.push(sym.schemaKeys);
      semaData.schemaTypes.push(sym.schemaTypes);
    });
    analyzedSymbols = semaData;
    logger.info("✓ Semantic analysis passed");
  } else {
    logger.info("Skipping semantic analysis (--skip-semantic-analysis)");
  }

  // Create TypeScript type checker if compiling .ts files
  let typeChecker: TypeChecker | null = null;
  if (inputFile.endsWith(".ts") || inputFile.endsWith(".tsx")) {
    try {
      const files: { filename: string; code: string }[] = [];
      for (let fci = 0; fci < fileContentKeys.length; fci++) {
        const filename = fileContentKeys[fci];
        const code = fileContentValues[fci];
        if (filename.endsWith(".ts") || filename.endsWith(".tsx")) {
          files.push({ filename, code });
        }
      }
      if (files.length > 0) {
        typeChecker = new TypeChecker(files);
      }
    } catch (error) {
      const errorObj = error as { message?: string; stack?: string };
      logger.warn(
        "Warning: Could not load TypeScript types: " + (errorObj.message || String(error)),
      );
      if (errorObj.stack) {
        logger.warn("Stack trace: " + errorObj.stack);
      }
    }
  }

  // Generate LLVM IR
  let entryFileCode = "";
  for (let efci = 0; efci < fileContentKeys.length; efci++) {
    if (fileContentKeys[efci] === inputFile) {
      entryFileCode = fileContentValues[efci];
      break;
    }
  }
  const generatorOptions: LLVMGeneratorOptions = {
    sourceCode: entryFileCode,
    filename: inputFile,
    debugInfo,
    debugFilename: debugInfo ? path.resolve(inputFile) : undefined,
    analyzedSymbols,
    target,
  };
  const generator = new LLVMGenerator(mergedAST, typeChecker, generatorOptions);
  generator.diagnostics.setColor(diagnosticColorEnabled);
  const llvmIR = generator.generate();

  // Write IR to file
  const irFile = outputFile + ".ll";
  fs.writeFileSync(irFile, llvmIR);

  // If --emit-llvm is set, stop here (don't compile or link)
  if (emitLLVMOnly) {
    logger.info(`LLVM IR written to ${irFile}`);
    return;
  }

  // Compile IR to object file
  const objFile = outputFile + ".o";
  const sanitizeFlags = sanitize ? ` -fsanitize=${sanitize}` : "";
  const llcStdio = logger.getLevel() >= LogLevel.Verbose ? "inherit" : "pipe";
  const cpuFlag = crossCompiling ? `-mcpu=${target.cpu}` : `-mcpu=${targetCpu}`;
  const tripleFlag = crossCompiling ? ` -mtriple=${target.triple}` : "";
  let compileCmd: string;
  if (sanitize) {
    compileCmd = `${linkerPath} -c${sanitizeFlags} ${irFile} -o ${objFile}`;
  } else if (debugInfo) {
    compileCmd = `${llcPath} -O0${tripleFlag} -filetype=obj ${irFile} -o ${objFile}`;
  } else {
    const optFile = irFile.replace(".ll", ".opt.bc");
    const optCmd = `${optPath} -O2 ${cpuFlag}${tripleFlag} ${irFile} -o ${optFile}`;
    logger.info(` ${optCmd}`);
    execSync(optCmd, { stdio: llcStdio });
    compileCmd = `${llcPath} -O2 ${cpuFlag}${tripleFlag} -filetype=obj ${optFile} -o ${objFile}`;
  }
  logger.info(` ${compileCmd}`);
  execSync(compileCmd, { stdio: llcStdio });

  // Link to executable - only link libraries that the program actually uses.
  // When cross-compiling, we use pre-built libraries from the target SDK
  // instead of the host's vendor/ and c_bridges/ directories.
  const targetIsMac = target.os === "darwin";
  const hostIsMac = process.platform === "darwin";

  let sdk: TargetSDK | null = null;
  if (crossCompiling) {
    sdk = ensureTargetSDK(target);
    logger.info(`Using target SDK: ${sdk.root}`);
  }

  // Resolve library and bridge paths — SDK overrides local paths when cross-compiling
  const gcPath = sdk ? sdk.vendorPath : BDWGC_PATH;
  const yyjsonPath = sdk ? sdk.vendorPath : YYJSON_PATH;
  const uvPath = sdk ? sdk.vendorPath : LIBUV_PATH;
  const bridgePath = sdk ? sdk.bridgesPath : LWS_BRIDGE_PATH;
  const picoPath = sdk ? sdk.vendorPath : PICOHTTPPARSER_PATH;
  const treeSitterPath = sdk ? sdk.vendorPath : TREESITTER_LIB_PATH;

  const platformLibs = targetIsMac ? "" : " -lm -ldl -lrt -lpthread";
  let linkLibs = `-L${gcPath} -lgc` + platformLibs;
  if (generator.usesJson) {
    linkLibs += ` -L${yyjsonPath} -lyyjson`;
  }
  if (
    generator.usesTimers ||
    generator.usesPromises ||
    generator.usesCurl ||
    generator.usesUvHrtime ||
    generator.usesMongoose
  ) {
    linkLibs += ` -L${uvPath} -luv`;
  }
  if (generator.usesCurl) {
    linkLibs += " -lcurl";
  }
  if (generator.usesCrypto) {
    linkLibs += " -lcrypto";
  }
  if (generator.usesSqlite) {
    linkLibs += " -lsqlite3";
  }
  if (generator.usesMongoose) {
    linkLibs += ` -lz -lzstd`;
  }

  // Platform-specific library search paths
  if (sdk) {
    // Cross-compiling: use SDK sysroot for CRT objects and system libraries.
    // --sysroot tells clang the root for system paths, and -L ensures the
    // linker finds our flat lib directory (bypassing multiarch path detection).
    if (sdk.sysrootPath) {
      linkLibs = `--sysroot=${sdk.sysrootPath} -L${sdk.sysrootPath}/usr/lib ` + linkLibs;
    }
  } else if (targetIsMac && hostIsMac) {
    // Native macOS: use Homebrew paths and Xcode SDK
    const brewPrefix = process.arch === "arm64" ? "/opt/homebrew/opt" : "/usr/local/opt";
    if (generator.usesCrypto) {
      linkLibs = `-L${brewPrefix}/openssl/lib ` + linkLibs;
    }
    if (generator.usesSqlite) {
      linkLibs = `-L${brewPrefix}/sqlite/lib ` + linkLibs;
    }
    if (generator.usesMongoose) {
      linkLibs = `-L${brewPrefix}/zstd/lib ` + linkLibs;
    }
    const sdkPath = execSync("xcrun --show-sdk-path", { stdio: "pipe", encoding: "utf8" }).trim();
    const usrLocalLib = fs.existsSync("/usr/local/lib") ? " -L/usr/local/lib" : "";
    linkLibs = `-Wl,-syslibroot,${sdkPath}${usrLocalLib} ` + linkLibs;
  }

  // Bridge object files
  const lwsBridgeObj = generator.usesMongoose
    ? `${bridgePath}/lws-bridge.o ${picoPath}/picohttpparser.o ${bridgePath}/multipart-bridge.o`
    : "";
  const regexBridgeObj = generator.usesRegex ? `${bridgePath}/regex-bridge.o` : "";
  const cpBridgeObj = `${bridgePath}/child-process-bridge.o`;
  const osBridgeObj = `${bridgePath}/os-bridge.o`;
  const dotenvBridgeObj = fs.existsSync(`${bridgePath}/dotenv-bridge.o`)
    ? `${bridgePath}/dotenv-bridge.o`
    : "";
  const watchBridgeObj = `${bridgePath}/watch-bridge.o`;
  const cpSpawnObj = generator.getUsesSpawn() ? `${bridgePath}/child-process-spawn.o` : "";
  let extraObjs = "";

  if (generator.getUsesTreeSitter()) {
    if (sdk) {
      // Cross-compiling: tree-sitter objects should be in the SDK
      const sdkTsParser = path.join(sdk.vendorPath, "tree-sitter-typescript-parser.o");
      const sdkTsScanner = path.join(sdk.vendorPath, "tree-sitter-typescript-scanner.o");
      const sdkTsBridge = path.join(sdk.bridgesPath, "treesitter-bridge.o");
      if (fs.existsSync(sdkTsParser)) {
        extraObjs = ` ${sdkTsParser} ${sdkTsScanner} ${sdkTsBridge}`;
      }
      linkLibs += ` ${treeSitterPath}/libtree-sitter.a`;
    } else {
      // Native: compile tree-sitter objects on the fly
      logger.info("  Compiling tree-sitter-typescript...");
      const buildDir = path.join(process.cwd(), "build");
      if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
      }

      const tsParserObj = path.join(buildDir, "tree-sitter-typescript-parser.o");
      const tsScannerObj = path.join(buildDir, "tree-sitter-typescript-scanner.o");
      const tsInclude = path.join(process.cwd(), TREESITTER_TS_PATH);
      const commonInclude = path.join(process.cwd(), "node_modules/tree-sitter-typescript");

      if (!fs.existsSync(tsParserObj)) {
        const parserSrc = path.join(tsInclude, "parser.c");
        const compileParser = `${linkerPath} -c -O2 -fPIC -I ${tsInclude} -I ${commonInclude} ${parserSrc} -o ${tsParserObj}`;
        logger.info(`  Compiling tree-sitter parser...`);
        execSync(compileParser, { stdio: "pipe" });
      }

      if (!fs.existsSync(tsScannerObj)) {
        const scannerSrc = path.join(tsInclude, "scanner.c");
        const compileScanner = `${linkerPath} -c -O2 -fPIC -I ${tsInclude} -I ${commonInclude} ${scannerSrc} -o ${tsScannerObj}`;
        logger.info(`  Compiling tree-sitter scanner...`);
        execSync(compileScanner, { stdio: "pipe" });
      }

      const bridgeObj = path.join(buildDir, "treesitter-bridge.o");
      if (!fs.existsSync(bridgeObj)) {
        const bridgeSrc = path.join(process.cwd(), "c_bridges", "treesitter-bridge.c");
        const tsLibInclude = path.join(process.cwd(), TREESITTER_LIB_PATH, "lib", "include");
        const compileBridge = `${linkerPath} -c -O2 -fPIC -I ${tsLibInclude} ${bridgeSrc} -o ${bridgeObj}`;
        logger.info(`  Compiling tree-sitter bridge...`);
        execSync(compileBridge, { stdio: "pipe" });
      }

      extraObjs = ` ${tsParserObj} ${tsScannerObj} ${bridgeObj}`;
      linkLibs += ` ${TREESITTER_LIB_PATH}/libtree-sitter.a`;
    }
  }

  let linker = useClang ? linkerPath : "gcc";
  if (sanitize) {
    linker = "gcc";
  }
  // -no-pie: only for native Linux builds (not macOS, not cross-compiling from macOS)
  const noPie = !targetIsMac && !crossCompiling ? " -no-pie" : "";
  const debugFlag = debugInfo ? " -g" : "";
  // Strip symbol table from release builds — keeps binaries small and clean.
  // Skip when -g is set (stripped + debug info produces nothing useful).
  const stripFlag = !debugInfo && !targetIsMac ? " -s" : "";
  // Cross-compiled Linux binaries always link statically — the SDK's sysroot
  // contains .a archives only (Ubuntu's .so files are linker scripts with
  // hardcoded absolute paths that can't be relocated to a different sysroot).
  const shouldStatic = (!targetIsMac && crossCompiling) || (staticLink && !targetIsMac);
  const staticFlag = shouldStatic ? " -static" : "";
  const crossTarget = crossCompiling ? ` --target=${target.triple}` : "";
  // Cross-compiling requires lld (LLVM's linker) — the host linker (e.g. macOS ld)
  // can't produce binaries for a different platform. Use the full path because
  // Homebrew's clang can't find lld by short name on macOS CI runners.
  // Try ld.lld first (ELF-specific), fall back to lld (multicall binary, auto-detects format).
  const crossLinker = crossCompiling ? ` -fuse-ld=${findLLD()}` : "";
  // User-provided linker flags (--link-obj, --link-lib, --link-path)
  const userObjs = extraLinkObjs.length > 0 ? " " + extraLinkObjs.join(" ") : "";
  const userPaths = extraLinkPaths.map((p) => ` -L${p}`).join("");
  const userLibs = extraLinkLibs.map((l) => ` -l${l}`).join("");
  const linkCmd = `${linker} ${objFile} ${lwsBridgeObj} ${regexBridgeObj} ${cpBridgeObj} ${osBridgeObj} ${dotenvBridgeObj} ${watchBridgeObj} ${cpSpawnObj}${extraObjs}${userObjs} -o ${outputFile}${noPie}${debugFlag}${stripFlag}${staticFlag}${crossTarget}${crossLinker}${sanitizeFlags} ${linkLibs}${userPaths}${userLibs}`;
  logger.info(` ${linkCmd}`);
  const linkStdio = logger.getLevel() >= LogLevel.Verbose ? "inherit" : "pipe";
  execSync(linkCmd, { stdio: linkStdio });

  // Clean up intermediate files (unless --keep-temps is set)
  if (!keepTemps) {
    try {
      fs.unlinkSync(objFile);
    } catch (e) {
      // File may already be deleted, ignore
    }
    if (!debugInfo) {
      try {
        fs.unlinkSync(irFile);
      } catch (e) {
        // File may already be deleted, ignore
      }
    }
  }

  // Silent on success (like clang)
}

function compileMultiFile(
  entryFile: string,
  compiledFiles: string[],
  fileContentKeys: string[],
  fileContentValues: string[],
  displayPath?: string,
): AST {
  const absPath = path.resolve(entryFile);

  for (let cfi = 0; cfi < compiledFiles.length; cfi++) {
    if (compiledFiles[cfi] === absPath) {
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
  }
  compiledFiles.push(absPath);

  logger.info(`  Parsing: ${absPath}`);
  const code = fs.readFileSync(absPath, "utf8");
  fileContentKeys.push(absPath);
  fileContentValues.push(code);

  const pathForErrors = displayPath || absPath;

  const ast = parseWithTSAPI(code, { filename: pathForErrors });

  let mergedAST: AST = {
    imports: ast.imports.slice(),
    functions: ast.functions.slice(),
    classes: ast.classes.slice(),
    exports: ast.exports.slice(),
    interfaces: ast.interfaces.slice(),
    typeAliases: ast.typeAliases ? ast.typeAliases.slice() : [],
    enums: ast.enums ? ast.enums.slice() : [],
    defaultExportName: ast.defaultExportName,
    topLevelStatements: ast.topLevelStatements.slice(),
    topLevelExpressions: ast.topLevelExpressions.slice(),
    topLevelItems: ast.topLevelItems ? ast.topLevelItems.slice() : [],
    topLevelItemTypes: ast.topLevelItemTypes ? ast.topLevelItemTypes.slice() : [],
    importAliasNames: [],
    importAliasOriginals: [],
  };

  let hasUnsupportedImports = false;
  for (let ui = 0; ui < ast.imports.length; ui++) {
    const imp = ast.imports[ui];
    if (imp.source === "typescript") {
      hasUnsupportedImports = true;
      break;
    }
  }
  if (hasUnsupportedImports) {
    return {
      imports: [],
      functions: [],
      classes: [],
      exports: [],
      interfaces: ast.interfaces.slice(),
      typeAliases: ast.typeAliases ? ast.typeAliases.slice() : [],
      enums: ast.enums ? ast.enums.slice() : [],
      defaultExportName: undefined,
      topLevelStatements: [],
      topLevelExpressions: [],
      topLevelItems: [],
      topLevelItemTypes: [],
      importAliasNames: [],
      importAliasOriginals: [],
    };
  }

  let i = 0;
  while (i < ast.imports.length) {
    const imp = ast.imports[i];

    const isRelativeOrAbsolute =
      imp.source.startsWith("./") || imp.source.startsWith("../") || imp.source.startsWith("/");

    if (!isRelativeOrAbsolute) {
      let isBuiltinModule = false;
      if (
        imp.source === "fs" ||
        imp.source === "path" ||
        imp.source === "child_process" ||
        imp.source === "typescript"
      ) {
        isBuiltinModule = true;
      }
      if (isBuiltinModule) {
        i = i + 1;
        continue;
      }

      const npmPath = resolveNodeModule(absPath, imp.source);
      if (npmPath) {
        const importedAST = compileMultiFile(
          npmPath,
          compiledFiles,
          fileContentKeys,
          fileContentValues,
        );
        if (imp.defaultImport && importedAST.defaultExportName) {
          const defLocal = imp.defaultImport;
          const defExported = importedAST.defaultExportName;
          if (defLocal !== defExported) {
            for (let ci = 0; ci < importedAST.classes.length; ci++) {
              const cls = importedAST.classes[ci];
              if (cls.name === defExported) {
                const aliasClass: ClassNode = {
                  name: defLocal,
                  extends: cls.extends,
                  implements: cls.implements,
                  fields: cls.fields,
                  methods: cls.methods,
                };
                importedAST.classes.push(aliasClass);
                break;
              }
            }
            for (let fi = 0; fi < importedAST.functions.length; fi++) {
              const fn = importedAST.functions[fi];
              if (fn.name === defExported) {
                const aliasFn: FunctionNode = {
                  name: defLocal,
                  params: fn.params,
                  body: fn.body,
                  returnType: fn.returnType,
                  paramTypes: fn.paramTypes,
                };
                importedAST.functions.push(aliasFn);
                break;
              }
            }
          }
        }
        mergedAST.imports = mergedAST.imports.concat(importedAST.imports);
        mergedAST.functions = mergedAST.functions.concat(importedAST.functions);
        mergedAST.classes = mergedAST.classes.concat(importedAST.classes);
        mergedAST.interfaces = mergedAST.interfaces.concat(importedAST.interfaces);
        mergedAST.typeAliases = mergedAST.typeAliases.concat(importedAST.typeAliases || []);
        mergedAST.enums = mergedAST.enums.concat(importedAST.enums || []);
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
        if (importedAST.importAliasNames && importedAST.importAliasNames.length > 0) {
          mergedAST.importAliasNames = mergedAST.importAliasNames!.concat(
            importedAST.importAliasNames,
          );
          mergedAST.importAliasOriginals = mergedAST.importAliasOriginals!.concat(
            importedAST.importAliasOriginals!,
          );
        }
        i = i + 1;
        continue;
      }

      throw new Error(
        "Cannot resolve npm package '" +
          imp.source +
          "' imported in " +
          absPath +
          "\n" +
          "Package not found in node_modules or missing TypeScript source.",
      );
    }

    const importPath = resolveImportPath(absPath, imp.source);
    const importedAST = compileMultiFile(
      importPath,
      compiledFiles,
      fileContentKeys,
      fileContentValues,
    );

    // Map default imports using struct-of-arrays pattern (native compiler safe).
    // When `import Foo from './bar'` and bar.ts has `export default Bar`,
    // add a duplicate class/function with the local name so codegen can find it.
    // We can't mutate existing ClassNode.name in native code, so we duplicate.
    const hasDefImport = imp.defaultImport ? true : false;
    const hasDefExport = importedAST.defaultExportName ? true : false;
    if (hasDefImport && hasDefExport) {
      const defLocal = imp.defaultImport!;
      const defExported = importedAST.defaultExportName!;
      if (defLocal !== defExported) {
        // When names differ (e.g. `import Foo from './bar'` where bar exports `Bar`),
        // duplicate the class/function with the local name so codegen can find it.
        // We duplicate instead of renaming because native code can't reliably mutate struct fields.
        for (let ci = 0; ci < importedAST.classes.length; ci++) {
          const cls = importedAST.classes[ci];
          if (cls.name === defExported) {
            const aliasClass: ClassNode = {
              name: defLocal,
              extends: cls.extends,
              implements: cls.implements,
              fields: cls.fields,
              methods: cls.methods,
            };
            importedAST.classes.push(aliasClass);
            break;
          }
        }
        for (let fi = 0; fi < importedAST.functions.length; fi++) {
          const fn = importedAST.functions[fi];
          if (fn.name === defExported) {
            // Match native parser FunctionNode field order exactly
            const aliasFn: FunctionNode = {
              name: defLocal,
              params: fn.params,
              body: fn.body,
              returnType: fn.returnType,
              paramTypes: fn.paramTypes,
            };
            importedAST.functions.push(aliasFn);
            break;
          }
        }
      }
    }

    mergedAST.imports = mergedAST.imports.concat(importedAST.imports);
    mergedAST.functions = mergedAST.functions.concat(importedAST.functions);
    mergedAST.classes = mergedAST.classes.concat(importedAST.classes);
    mergedAST.interfaces = mergedAST.interfaces.concat(importedAST.interfaces);
    mergedAST.typeAliases = mergedAST.typeAliases.concat(importedAST.typeAliases || []);
    mergedAST.enums = mergedAST.enums.concat(importedAST.enums || []);
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
    // Merge import aliases from child ASTs
    if (importedAST.importAliasNames && importedAST.importAliasNames.length > 0) {
      mergedAST.importAliasNames = mergedAST.importAliasNames!.concat(importedAST.importAliasNames);
      mergedAST.importAliasOriginals = mergedAST.importAliasOriginals!.concat(
        importedAST.importAliasOriginals!,
      );
    }
    i = i + 1;
  }

  return mergedAST;
}

function resolveImportPath(fromFile: string, importSource: string): string {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir, importSource);

  // If the import has .js extension, prefer .ts/.tsx source over compiled .js
  if (importSource.endsWith(".js")) {
    const tsPath = resolved.replace(/\.js$/, ".ts");
    if (fs.existsSync(tsPath)) {
      return tsPath;
    }
    const tsxPath = resolved.replace(/\.js$/, ".tsx");
    if (fs.existsSync(tsxPath)) {
      return tsxPath;
    }
  }

  // Extensionless imports: try .ts then .tsx
  if (
    !importSource.endsWith(".ts") &&
    !importSource.endsWith(".tsx") &&
    !importSource.endsWith(".js")
  ) {
    if (fs.existsSync(resolved + ".ts")) {
      return resolved + ".ts";
    }
    if (fs.existsSync(resolved + ".tsx")) {
      return resolved + ".tsx";
    }
  }

  return resolved;
}

function resolveNodeModule(fromFile: string, packageName: string): string | null {
  let dir = path.dirname(fromFile);

  while (dir !== path.dirname(dir)) {
    const nodeModulesPath = path.join(dir, "node_modules", packageName);

    if (fs.existsSync(nodeModulesPath)) {
      const pkgJsonPath = path.join(nodeModulesPath, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        const entryPoints = [
          pkgJson.main?.replace(/\.js$/, ".ts"),
          pkgJson.main?.replace(/\.js$/, ".tsx"),
          pkgJson.main?.replace(/\.js$/, ""),
          "index.ts",
          "index.tsx",
          "src/index.ts",
          "src/index.tsx",
        ].filter(Boolean);

        for (const entry of entryPoints) {
          const entryPath = path.join(nodeModulesPath, entry);
          if (fs.existsSync(entryPath)) {
            return entryPath;
          }
          if (fs.existsSync(entryPath + ".ts")) {
            return entryPath + ".ts";
          }
        }
      }

      const indexTs = path.join(nodeModulesPath, "index.ts");
      if (fs.existsSync(indexTs)) {
        return indexTs;
      }
    }

    dir = path.dirname(dir);
  }

  return null;
}
