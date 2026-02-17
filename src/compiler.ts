import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { parseWithTSAPI } from './parser-ts/index.js';
import { LLVMGenerator, LLVMGeneratorOptions, SemaSymbolData } from './codegen/llvm-generator.js';
import { TypeChecker } from './typescript/type-checker.js';
import { SemanticAnalyzer, TypedSymbol } from './analysis/semantic-analyzer.js';
import { AST } from './ast/types.js';
import { LogLevel, logger } from './utils/logger.js';

function findLLVMTool(name: string): string {
  const candidates = [
    '/opt/homebrew/opt/llvm/bin/' + name,
    '/usr/local/opt/llvm/bin/' + name,
  ];
  try {
    return execSync('which ' + name, { stdio: 'pipe', encoding: 'utf8' }).trim();
  } catch (e) {
    // bare name not in PATH — check Homebrew locations
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'chad: error: ' + name + ' not found\n' +
    'Install LLVM:\n' +
    '  macOS: brew install llvm\n' +
    '  Ubuntu/Debian: sudo apt-get install llvm clang\n' +
    '  Fedora: sudo dnf install llvm clang'
  );
}

let skipSemanticAnalysis = false;
let keepTemps = false;
let emitLLVMOnly = false;
let sanitize: string | null = null;
let debugInfo = false;
let staticLink = false;

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

// External library paths - check env vars, then use vendor/
const BDWGC_PATH = process.env.CHADSCRIPT_BDWGC_PATH || './vendor/bdwgc';
const LWS_PATH = process.env.CHADSCRIPT_LWS_PATH || './vendor/libwebsockets/build';
const LWS_BRIDGE_PATH = process.env.CHADSCRIPT_LWS_BRIDGE_PATH || './c_bridges';
const YYJSON_PATH = process.env.CHADSCRIPT_YYJSON_PATH || './vendor/yyjson';
const LIBUV_PATH = process.env.CHADSCRIPT_LIBUV_PATH || './vendor/libuv/build';
const TREESITTER_LIB_PATH = process.env.CHADSCRIPT_TREESITTER_PATH || './vendor/tree-sitter';
const TREESITTER_TS_PATH = 'node_modules/tree-sitter-typescript/typescript/src';

// ============================================
// MAIN COMPILER DRIVER
// ============================================

export function compile(inputFile: string, outputFile: string, logLevel: LogLevel = LogLevel.Normal): void {
  // Set the global logger level
  logger.setLevel(logLevel);

  // Get version from package.json
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = packageJson.version;

  logger.info(`ChadScript compiler version ${version}`);
  logger.info(`Target: ${process.arch}-${process.platform}`);
  logger.info(`InstalledDir: ${process.cwd()}`);

  // Check for required build tools
  const llcPath = findLLVMTool('llc');
  const optPath = findLLVMTool('opt');
  let linkerPath: string;
  let useClang = true;

  try {
    linkerPath = findLLVMTool('clang');
  } catch (error) {
    try {
      linkerPath = execSync('which gcc', { stdio: 'pipe', encoding: 'utf8' }).trim();
      useClang = false;
    } catch (gccError) {
      throw new Error(
        'chad: error: clang or gcc not found in PATH\n' +
        'Install a C compiler:\n' +
        '  macOS: xcode-select --install\n' +
        '  Ubuntu/Debian: sudo apt-get install clang\n' +
        '  RHEL/Fedora: sudo yum install clang'
      );
    }
  }

  // Parse all files (starting from entry point, following imports)
  const compiledFiles: string[] = [];
  const fileContentKeys: string[] = [];
  const fileContentValues: string[] = [];
  const mergedAST = compileMultiFile(inputFile, compiledFiles, fileContentKeys, fileContentValues, inputFile);

  // Run semantic analysis to catch type errors early (unless skipped)
  let analyzedSymbols: SemaSymbolData | undefined = undefined;
  if (!skipSemanticAnalysis) {
    logger.info('Running semantic analysis...');
    const analyzer = new SemanticAnalyzer(mergedAST);
    const analysisSuccess = analyzer.analyze();

    if (!analysisSuccess) {
      const errorOutput = analyzer.formatErrors();
      console.error(errorOutput);
      throw new Error('Semantic analysis failed. Fix the errors above and try again.');
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
    logger.info('✓ Semantic analysis passed');
  } else {
    logger.info('Skipping semantic analysis (--skip-semantic-analysis)');
  }

  // Create TypeScript type checker if compiling .ts files
  let typeChecker: TypeChecker | null = null;
  if (inputFile.endsWith('.ts')) {
    try {
      const files: { filename: string; code: string }[] = [];
      for (let fci = 0; fci < fileContentKeys.length; fci++) {
        const filename = fileContentKeys[fci];
        const code = fileContentValues[fci];
        if (filename.endsWith('.ts')) {
          files.push({ filename, code });
        }
      }
      if (files.length > 0) {
        typeChecker = new TypeChecker(files);
      }
    } catch (error) {
      const errorObj = error as { message?: string; stack?: string };
      logger.warn('Warning: Could not load TypeScript types: ' + (errorObj.message || String(error)));
      if (errorObj.stack) {
        logger.warn('Stack trace: ' + errorObj.stack);
      }
    }
  }

  // Generate LLVM IR
  let entryFileCode = '';
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
  };
  const generator = new LLVMGenerator(mergedAST, typeChecker, generatorOptions);
  const llvmIR = generator.generate();

  // Write IR to file
  const irFile = outputFile + '.ll';
  fs.writeFileSync(irFile, llvmIR);

  // If --emit-llvm is set, stop here (don't compile or link)
  if (emitLLVMOnly) {
    logger.info(`LLVM IR written to ${irFile}`);
    return;
  }

  // Compile IR to object file
  const objFile = outputFile + '.o';
  const sanitizeFlags = sanitize ? ` -fsanitize=${sanitize}` : '';
  const llcStdio = logger.getLevel() >= LogLevel.Verbose ? 'inherit' : 'pipe';
  let compileCmd: string;
  if (sanitize) {
    compileCmd = `${linkerPath} -c${sanitizeFlags} ${irFile} -o ${objFile}`;
  } else if (debugInfo) {
    compileCmd = `${llcPath} -O0 -filetype=obj ${irFile} -o ${objFile}`;
  } else {
    const optFile = irFile.replace('.ll', '.opt.bc');
    const optCmd = `${optPath} -O2 -mcpu=native ${irFile} -o ${optFile}`;
    logger.info(` ${optCmd}`);
    execSync(optCmd, { stdio: llcStdio });
    compileCmd = `${llcPath} -O2 -mcpu=native -filetype=obj ${optFile} -o ${objFile}`;
  }
  logger.info(` ${compileCmd}`);
  execSync(compileCmd, { stdio: llcStdio });

  // Link to executable - only link libraries that the program actually uses
  const isMac = process.platform === 'darwin';
  const platformLibs = isMac ? '' : ' -lm -ldl -lrt';
  let linkLibs = `-L${BDWGC_PATH} -lgc -lpthread` + platformLibs;
  if (generator.usesJson) { linkLibs += ` -L${YYJSON_PATH} -lyyjson`; }
  if (generator.usesTimers || generator.usesPromises || generator.usesCurl || generator.usesUvHrtime) { linkLibs += ` -L${LIBUV_PATH} -luv`; }
  if (generator.usesCurl) { linkLibs += ' -lcurl'; }
  if (generator.usesCrypto) { linkLibs += ' -lcrypto'; }
  if (generator.usesSqlite) { linkLibs += ' -lsqlite3'; }
  if (generator.usesMongoose) { linkLibs += ` -L${LWS_PATH}/lib -lwebsockets -lz -lzstd`; }
  if (isMac) {
    const brewPrefix = process.arch === 'arm64' ? '/opt/homebrew/opt' : '/usr/local/opt';
    if (generator.usesCrypto) { linkLibs = `-L${brewPrefix}/openssl/lib ` + linkLibs; }
    if (generator.usesSqlite) { linkLibs = `-L${brewPrefix}/sqlite/lib ` + linkLibs; }
    if (generator.usesMongoose) { linkLibs = `-L${brewPrefix}/zstd/lib ` + linkLibs; }
    linkLibs = `-L/usr/local/lib ` + linkLibs;
  }
  const lwsBridgeObj = generator.usesMongoose ? `${LWS_BRIDGE_PATH}/lws-bridge.o` : '';
  const regexBridgeObj = generator.usesRegex ? `${LWS_BRIDGE_PATH}/regex-bridge.o` : '';
  let extraObjs = '';

  if (generator.getUsesTreeSitter()) {
    logger.info('  Compiling tree-sitter-typescript...');
    const buildDir = path.join(process.cwd(), 'build');
    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir, { recursive: true });
    }

    const tsParserObj = path.join(buildDir, 'tree-sitter-typescript-parser.o');
    const tsScannerObj = path.join(buildDir, 'tree-sitter-typescript-scanner.o');
    const tsInclude = path.join(process.cwd(), TREESITTER_TS_PATH);
    const commonInclude = path.join(process.cwd(), 'node_modules/tree-sitter-typescript');

    if (!fs.existsSync(tsParserObj)) {
      const parserSrc = path.join(tsInclude, 'parser.c');
      const compileParser = `${linkerPath} -c -O2 -fPIC -I ${tsInclude} -I ${commonInclude} ${parserSrc} -o ${tsParserObj}`;
      logger.info(`  Compiling tree-sitter parser...`);
      execSync(compileParser, { stdio: 'pipe' });
    }

    if (!fs.existsSync(tsScannerObj)) {
      const scannerSrc = path.join(tsInclude, 'scanner.c');
      const compileScanner = `${linkerPath} -c -O2 -fPIC -I ${tsInclude} -I ${commonInclude} ${scannerSrc} -o ${tsScannerObj}`;
      logger.info(`  Compiling tree-sitter scanner...`);
      execSync(compileScanner, { stdio: 'pipe' });
    }

    const bridgeObj = path.join(buildDir, 'treesitter-bridge.o');
    if (!fs.existsSync(bridgeObj)) {
      const bridgeSrc = path.join(process.cwd(), 'c_bridges', 'treesitter-bridge.c');
      const tsLibInclude = path.join(process.cwd(), TREESITTER_LIB_PATH, 'lib', 'include');
      const compileBridge = `${linkerPath} -c -O2 -fPIC -I ${tsLibInclude} ${bridgeSrc} -o ${bridgeObj}`;
      logger.info(`  Compiling tree-sitter bridge...`);
      execSync(compileBridge, { stdio: 'pipe' });
    }

    extraObjs = ` ${tsParserObj} ${tsScannerObj} ${bridgeObj}`;
    linkLibs += ` ${TREESITTER_LIB_PATH}/libtree-sitter.a`;
  }

  let linker = useClang ? linkerPath : 'gcc';
  if (sanitize) {
    linker = 'gcc';
  }
  const noPie = isMac ? '' : ' -no-pie';
  const debugFlag = debugInfo ? ' -g' : '';
  const staticFlag = (staticLink && !isMac) ? ' -static' : '';
  const linkCmd = `${linker} ${objFile} ${lwsBridgeObj} ${regexBridgeObj}${extraObjs} -o ${outputFile}${noPie}${debugFlag}${staticFlag}${sanitizeFlags} ${linkLibs}`;
  logger.info(` ${linkCmd}`);
  const linkStdio = logger.getLevel() >= LogLevel.Verbose ? 'inherit' : 'pipe';
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

function compileMultiFile(entryFile: string, compiledFiles: string[], fileContentKeys: string[], fileContentValues: string[], displayPath?: string): AST {
  const absPath = path.resolve(entryFile);

  for (let cfi = 0; cfi < compiledFiles.length; cfi++) {
    if (compiledFiles[cfi] === absPath) {
      return { imports: [], functions: [], classes: [], exports: [], interfaces: [], typeAliases: [], enums: [], topLevelStatements: [], topLevelExpressions: [], topLevelItems: [], topLevelItemTypes: [] };
    }
  }
  compiledFiles.push(absPath);

  logger.info(`  Parsing: ${absPath}`);
  const code = fs.readFileSync(absPath, 'utf8');
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
    topLevelStatements: ast.topLevelStatements.slice(),
    topLevelExpressions: ast.topLevelExpressions.slice(),
    topLevelItems: ast.topLevelItems ? ast.topLevelItems.slice() : [],
    topLevelItemTypes: ast.topLevelItemTypes ? ast.topLevelItemTypes.slice() : []
  };

  let hasUnsupportedImports = false;
  for (let ui = 0; ui < ast.imports.length; ui++) {
    const imp = ast.imports[ui];
    if (imp.source === 'typescript') {
      hasUnsupportedImports = true;
      break;
    }
  }
  if (hasUnsupportedImports) {
    return { imports: [], functions: [], classes: [], exports: [], interfaces: ast.interfaces.slice(), typeAliases: ast.typeAliases ? ast.typeAliases.slice() : [], enums: ast.enums ? ast.enums.slice() : [], topLevelStatements: [], topLevelExpressions: [], topLevelItems: [], topLevelItemTypes: [] };
  }

  let i = 0;
  while (i < ast.imports.length) {
    const imp = ast.imports[i];

    const isRelativeOrAbsolute = imp.source.startsWith('./') ||
                                   imp.source.startsWith('../') ||
                                   imp.source.startsWith('/');

    if (!isRelativeOrAbsolute) {
      let isBuiltinModule = false;
      if (imp.source === 'fs' || imp.source === 'path' || imp.source === 'child_process' || imp.source === 'typescript') {
        isBuiltinModule = true;
      }
      if (isBuiltinModule) {
        i = i + 1;
        continue;
      }

      const npmPath = resolveNodeModule(absPath, imp.source);
      if (npmPath) {
        const importedAST = compileMultiFile(npmPath, compiledFiles, fileContentKeys, fileContentValues);
        mergedAST.imports = mergedAST.imports.concat(importedAST.imports);
        mergedAST.functions = mergedAST.functions.concat(importedAST.functions);
        mergedAST.classes = mergedAST.classes.concat(importedAST.classes);
        mergedAST.interfaces = mergedAST.interfaces.concat(importedAST.interfaces);
        mergedAST.typeAliases = mergedAST.typeAliases.concat(importedAST.typeAliases || []);
        mergedAST.enums = mergedAST.enums.concat(importedAST.enums || []);
        mergedAST.topLevelStatements = importedAST.topLevelStatements.concat(mergedAST.topLevelStatements);
        if (importedAST.topLevelItems) {
          mergedAST.topLevelItems = importedAST.topLevelItems.concat(mergedAST.topLevelItems || []);
        }
        if (importedAST.topLevelItemTypes) {
          mergedAST.topLevelItemTypes = importedAST.topLevelItemTypes.concat(mergedAST.topLevelItemTypes || []);
        }
        i = i + 1;
        continue;
      }

      throw new Error(
        'Cannot resolve npm package \'' + imp.source + '\' imported in ' + absPath + '\n' +
        'Package not found in node_modules or missing TypeScript source.'
      );
    }

    const importPath = resolveImportPath(absPath, imp.source);
    const importedAST = compileMultiFile(importPath, compiledFiles, fileContentKeys, fileContentValues);

    mergedAST.imports = mergedAST.imports.concat(importedAST.imports);
    mergedAST.functions = mergedAST.functions.concat(importedAST.functions);
    mergedAST.classes = mergedAST.classes.concat(importedAST.classes);
    mergedAST.interfaces = mergedAST.interfaces.concat(importedAST.interfaces);
    mergedAST.typeAliases = mergedAST.typeAliases.concat(importedAST.typeAliases || []);
    mergedAST.enums = mergedAST.enums.concat(importedAST.enums || []);
    mergedAST.topLevelStatements = importedAST.topLevelStatements.concat(mergedAST.topLevelStatements);
    if (importedAST.topLevelItems) {
      mergedAST.topLevelItems = importedAST.topLevelItems.concat(mergedAST.topLevelItems || []);
    }
    if (importedAST.topLevelItemTypes) {
      mergedAST.topLevelItemTypes = importedAST.topLevelItemTypes.concat(mergedAST.topLevelItemTypes || []);
    }
    i = i + 1;
  }

  return mergedAST;
}

function resolveImportPath(fromFile: string, importSource: string): string {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir, importSource);

  // If the import has .js extension, prefer .ts source over compiled .js
  if (importSource.endsWith('.js')) {
    const tsPath = resolved.replace(/\.js$/, '.ts');
    if (fs.existsSync(tsPath)) {
      return tsPath;
    }
  }

  return resolved;
}

function resolveNodeModule(fromFile: string, packageName: string): string | null {
  let dir = path.dirname(fromFile);

  while (dir !== path.dirname(dir)) {
    const nodeModulesPath = path.join(dir, 'node_modules', packageName);

    if (fs.existsSync(nodeModulesPath)) {
      const pkgJsonPath = path.join(nodeModulesPath, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        const entryPoints = [
          pkgJson.main?.replace(/\.js$/, '.ts'),
          pkgJson.main?.replace(/\.js$/, ''),
          'index.ts',
          'src/index.ts'
        ].filter(Boolean);

        for (const entry of entryPoints) {
          const entryPath = path.join(nodeModulesPath, entry);
          if (fs.existsSync(entryPath)) {
            return entryPath;
          }
          if (fs.existsSync(entryPath + '.ts')) {
            return entryPath + '.ts';
          }
        }
      }

      const indexTs = path.join(nodeModulesPath, 'index.ts');
      if (fs.existsSync(indexTs)) {
        return indexTs;
      }
    }

    dir = path.dirname(dir);
  }

  return null;
}
