import { parseSource } from './parser-native/index.js';
import { transformTree } from './parser-native/transformer.js';
import { LLVMGenerator, LLVMGeneratorOptions, SemaSymbolData } from './codegen/llvm-generator.js';
import { SemanticAnalyzer } from './analysis/semantic-analyzer.js';
import { AST, ImportDeclaration } from './ast/types.js';

declare const child_process: {
  execSync(command: string): number;
};

declare const fs: {
  readFileSync(filename: string): string;
  writeFileSync(filename: string, data: string): number;
  appendFileSync(filename: string, data: string): number;
  existsSync(filename: string): boolean;
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
  platform: string;
};

declare function __gc_disable(): void;

function findLLVMTool(name: string): string {
  const homebrewArm = '/opt/homebrew/opt/llvm/bin/' + name;
  const homebrewIntel = '/usr/local/opt/llvm/bin/' + name;
  if (fs.existsSync(homebrewArm)) {
    return homebrewArm;
  }
  if (fs.existsSync(homebrewIntel)) {
    return homebrewIntel;
  }
  return name;
}

export let skipSemanticAnalysis = false;
export let emitLLVMOnly = false;
export let verbose = false;

export function setSkipSemanticAnalysis(value: boolean): void {
  skipSemanticAnalysis = value;
}

export function setEmitLLVMOnly(value: boolean): void {
  emitLLVMOnly = value;
}

export function setVerbose(value: boolean): void {
  verbose = value;
}

export function compileNative(inputFile: string, outputFile: string): void {
  const execDir = path.dirname(path.resolve(process.argv[0]));
  const installedLibDir = execDir + '/lib';
  const isInstalled = fs.existsSync(installedLibDir + '/libgc.a');

  const BDWGC_PATH = isInstalled ? installedLibDir : './vendor/bdwgc';
  const LWS_PATH = isInstalled ? installedLibDir : './vendor/libwebsockets/build';
  const LWS_BRIDGE_PATH = isInstalled ? installedLibDir : './c_bridges';
  const CHADSCRIPT_PATH = '.';

  if (verbose) {
    console.log('ChadScript native compiler v0.1.0');
    console.log('Input file: ' + inputFile);
  }

  __gc_disable();

  const compiledFiles: string[] = [];
  const mergedAST = compileMultiFile(inputFile, compiledFiles);

  let semaSymbols: SemaSymbolData | undefined = undefined;
  if (skipSemanticAnalysis) {
    if (verbose) { console.log('Skipping semantic analysis (--skip-semantic-analysis)'); }
  } else {
    if (verbose) { console.log('Running semantic analysis...'); }
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
      if (stmt.type === 'variable_declaration') {
        const declName = (stmt as { name?: string }).name;
        if (declName) {
          const symType = analyzer.getSymbolTypeByName(declName);
          if (symType !== 'unknown') {
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
    if (verbose) { console.log('Semantic analysis passed'); }
  }

  if (verbose) { console.log('Generating LLVM IR...'); }
  const generatorOptions: LLVMGeneratorOptions = {
    sourceCode: '',
    filename: inputFile,
    analyzedSymbols: semaSymbols,
  };
  const generator = new LLVMGenerator(mergedAST, null, generatorOptions);
  const irParts = generator.generateParts();
  if (verbose) { console.log('Generated IR parts: ' + irParts.length); }

  const irFile = outputFile + '.ll';
  fs.writeFileSync(irFile, '');
  for (let pi = 0; pi < irParts.length; pi++) {
    const part = irParts[pi];
    if (verbose && part.indexOf('ts_parser_language') !== -1) {
      const preview = part.substr(0, 80);
      console.log('Part ' + pi + ' contains ts_parser_language, len=' + part.length + ' preview=' + preview);
    }
    fs.appendFileSync(irFile, part);
  }

  if (emitLLVMOnly) {
    if (verbose) { console.log('LLVM IR written to ' + irFile); }
    return;
  }

  const objFile = outputFile + '.o';
  const optFile = irFile.replace('.ll', '.opt.bc');
  const optTool = findLLVMTool('opt');
  const llcTool = findLLVMTool('llc');
  const clangTool = findLLVMTool('clang');
  const optCmd = optTool + ' -O2 -mcpu=native ' + irFile + ' -o ' + optFile;
  if (verbose) { console.log('Running: ' + optCmd); }
  child_process.execSync(optCmd);
  const llcCmd = llcTool + ' -O2 -mcpu=native -filetype=obj ' + optFile + ' -o ' + objFile;
  if (verbose) { console.log('Running: ' + llcCmd); }
  child_process.execSync(llcCmd);
  if (!fs.existsSync(objFile)) {
    console.log('Error: llc failed to produce ' + objFile);
    process.exit(1);
  }

  const isMac = process.platform === 'darwin';
  const platformLibs = isMac ? '' : ' -lm -ldl -lrt';
  const noPie = isMac ? '' : ' -no-pie';
  const tsObjDir = isInstalled ? installedLibDir : CHADSCRIPT_PATH + '/build';
  let treeSitterObjs = '';
  let tsLibPath = '';
  if (generator.getUsesTreeSitter()) {
    treeSitterObjs = tsObjDir + '/tree-sitter-typescript-parser.o ' + tsObjDir + '/tree-sitter-typescript-scanner.o ' + tsObjDir + '/treesitter-bridge.o';
    tsLibPath = isInstalled ? installedLibDir + '/libtree-sitter.a' : './vendor/tree-sitter/libtree-sitter.a';
  }
  let linkLibs = '-L' + BDWGC_PATH + ' -lgc -lpthread' + platformLibs;
  if (tsLibPath) { linkLibs = linkLibs + ' ' + tsLibPath; }
  const yyjsonDir = isInstalled ? installedLibDir : './vendor/yyjson';
  if (generator.getUsesJson()) { linkLibs = '-L' + yyjsonDir + ' -lyyjson ' + linkLibs; }
  const uvDir = isInstalled ? installedLibDir : './vendor/libuv/build';
  if (generator.getUsesTimers() || generator.getUsesPromises() || generator.getUsesCurl() || generator.getUsesUvHrtime()) { linkLibs = '-L' + uvDir + ' -luv ' + linkLibs; }
  if (generator.getUsesCurl()) { linkLibs = '-lcurl ' + linkLibs; }
  if (generator.getUsesCrypto()) { linkLibs = '-lcrypto ' + linkLibs; }
  if (generator.getUsesSqlite()) { linkLibs = '-lsqlite3 ' + linkLibs; }
  if (generator.getUsesMongoose()) { linkLibs = '-L' + LWS_PATH + '/lib -lwebsockets -lz -lzstd ' + linkLibs; }
  const lwsBridgeObj = generator.getUsesMongoose() ? LWS_BRIDGE_PATH + '/lws-bridge.o' : '';
  if (isMac) {
    if (generator.getUsesCrypto()) { linkLibs = '-L/opt/homebrew/opt/openssl/lib -L/usr/local/opt/openssl/lib ' + linkLibs; }
    if (generator.getUsesSqlite()) { linkLibs = '-L/opt/homebrew/opt/sqlite/lib -L/usr/local/opt/sqlite/lib ' + linkLibs; }
    if (generator.getUsesMongoose()) { linkLibs = '-L/opt/homebrew/opt/zstd/lib -L/usr/local/opt/zstd/lib ' + linkLibs; }
    linkLibs = '-L/usr/local/lib ' + linkLibs;
  }
  const linkCmd = clangTool + ' ' + objFile + ' ' + lwsBridgeObj + ' ' + treeSitterObjs + ' -o ' + outputFile + noPie + ' ' + linkLibs;
  if (verbose) { console.log('Running: ' + linkCmd); }
  child_process.execSync(linkCmd);
  if (!fs.existsSync(outputFile)) {
    console.log('Error: clang failed to produce ' + outputFile);
    process.exit(1);
  }

  fs.unlinkSync(objFile);
  if (verbose) { console.log('Compiled: ' + outputFile); }
}

export function compileMultiFile(entryFile: string, compiledFiles: string[]): AST {
  const absPath = path.resolve(entryFile);

  for (let i = 0; i < compiledFiles.length; i++) {
    if (compiledFiles[i] === absPath) {
      return emptyAST();
    }
  }
  compiledFiles.push(absPath);

  if (verbose) { console.log('Parsing: ' + absPath); }
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
    topLevelStatements: ast.topLevelStatements.slice(0),
    topLevelExpressions: ast.topLevelExpressions.slice(0),
    topLevelItems: ast.topLevelItems ? ast.topLevelItems.slice(0) : [],
    topLevelItemTypes: ast.topLevelItemTypes ? ast.topLevelItemTypes.slice(0) : []
  };

  let i = 0;
  while (i < ast.imports.length) {
    const imp = ast.imports[i] as ImportDeclaration;
    const src = imp.source;

    const isRelative = src.substr(0, 2) === './' || src.substr(0, 3) === '../' || src.substr(0, 1) === '/';

    if (!isRelative) {
      const builtins = ['fs', 'path', 'child_process'];
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
      console.log('Cannot compile npm package: ' + src);
      process.exit(1);
    }

    const importPath = resolveImportPath(absPath, src);
    const importedAST = compileMultiFile(importPath, compiledFiles);

    mergedAST.functions = mergedAST.functions.concat(importedAST.functions);
    mergedAST.classes = mergedAST.classes.concat(importedAST.classes);
    mergedAST.interfaces = mergedAST.interfaces.concat(importedAST.interfaces);
    mergedAST.typeAliases = mergedAST.typeAliases.concat(importedAST.typeAliases);
    mergedAST.enums = mergedAST.enums.concat(importedAST.enums);
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

export function resolveImportPath(fromFile: string, importSource: string): string {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir + '/' + importSource);

  // Prefer .ts source over compiled .js
  if (importSource.substr(importSource.length - 3) === '.js') {
    const tsPath = resolved.substr(0, resolved.length - 3) + '.ts';
    if (fs.existsSync(tsPath)) {
      return tsPath;
    }
  }

  if (fs.existsSync(resolved)) {
    return resolved;
  }

  if (fs.existsSync(resolved + '.ts')) {
    return resolved + '.ts';
  }

  if (fs.existsSync(resolved + '.js')) {
    return resolved + '.js';
  }

  console.log('Cannot resolve import: ' + importSource + ' from ' + fromFile);
  process.exit(1);
  return '';
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
    topLevelStatements: [],
    topLevelExpressions: [],
    topLevelItems: [],
    topLevelItemTypes: []
  };
}
