import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Parser } from './parser/parser.js';
import { parseWithTSAPI } from './parser-ts/index.js';
import { LLVMGenerator, LLVMGeneratorOptions } from './codegen/llvm-generator.js';
import { TypeChecker } from './typescript/type-checker.js';
import { SemanticAnalyzer } from './analysis/semantic-analyzer.js';
import { AST } from './ast/types.js';
import { LogLevel, logger } from './utils/logger.js';

let useTSParser = false;
let linkTreeSitter = false;
let skipSemanticAnalysis = false;
let keepTemps = false;
let emitLLVMOnly = false;
let sanitize: string | null = null;

export function setUseTSParser(value: boolean): void {
  useTSParser = value;
}

export function setLinkTreeSitter(value: boolean): void {
  linkTreeSitter = value;
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

// External library paths - check env vars, then use vendor/
const BDWGC_PATH = process.env.CHADSCRIPT_BDWGC_PATH || './vendor/bdwgc';
const MONGOOSE_PATH = process.env.CHADSCRIPT_MONGOOSE_PATH || './vendor/mongoose';
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
  let llcPath: string;
  let linkerPath: string;
  let useClang = true;

  try {
    llcPath = execSync('which llc', { stdio: 'pipe', encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error(
      'chadscript: error: llc (LLVM compiler) not found in PATH\n' +
      'Install LLVM:\n' +
      '  macOS: brew install llvm && export PATH="/opt/homebrew/opt/llvm/bin:$PATH"\n' +
      '  Ubuntu/Debian: sudo apt-get install llvm\n' +
      '  RHEL/Fedora: sudo yum install llvm'
    );
  }

  try {
    linkerPath = execSync('which clang', { stdio: 'pipe', encoding: 'utf8' }).trim();
  } catch (error) {
    try {
      linkerPath = execSync('which gcc', { stdio: 'pipe', encoding: 'utf8' }).trim();
      useClang = false;
    } catch (gccError) {
      throw new Error(
        'chadscript: error: clang or gcc not found in PATH\n' +
        'Install a C compiler:\n' +
        '  macOS: xcode-select --install\n' +
        '  Ubuntu/Debian: sudo apt-get install clang\n' +
        '  RHEL/Fedora: sudo yum install clang'
      );
    }
  }

  // Parse all files (starting from entry point, following imports)
  const compiledFiles = new Set<string>();
  const fileContents = new Map<string, string>();
  const mergedAST = compileMultiFile(inputFile, compiledFiles, fileContents, inputFile);

  // Run semantic analysis to catch type errors early (unless skipped)
  if (!skipSemanticAnalysis) {
    logger.info('Running semantic analysis...');
    const analyzer = new SemanticAnalyzer(mergedAST);
    const analysisSuccess = analyzer.analyze();

    if (!analysisSuccess) {
      const errorOutput = analyzer.formatErrors();
      console.error(errorOutput);
      throw new Error('Semantic analysis failed. Fix the errors above and try again.');
    }

    logger.info('✓ Semantic analysis passed');
  } else {
    logger.info('Skipping semantic analysis (--skip-semantic-analysis)');
  }

  // Create TypeScript type checker if compiling .ts files
  let typeChecker: TypeChecker | null = null;
  if (inputFile.endsWith('.ts')) {
    try {
      const files: { filename: string; code: string }[] = [];
      for (const [filename, code] of fileContents.entries()) {
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
  const entryFileCode = fileContents.get(inputFile) || '';
  const generatorOptions: LLVMGeneratorOptions = {
    linkTreeSitter: linkTreeSitter,
    sourceCode: entryFileCode,
    filename: inputFile
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
  let compileCmd: string;
  if (sanitize) {
    compileCmd = `clang -c${sanitizeFlags} ${irFile} -o ${objFile}`;
  } else {
    compileCmd = `llc -filetype=obj ${irFile} -o ${objFile}`;
  }
  logger.info(` ${compileCmd}`);
  const llcStdio = logger.getLevel() >= LogLevel.Verbose ? 'inherit' : 'pipe';
  execSync(compileCmd, { stdio: llcStdio });

  // Link to executable with all required libraries
  // - libgc: Boehm garbage collector (replaces malloc)
  // - mongoose: HTTP server (compiled object file)
  // - libcurl: HTTP client (fetch API)
  // - libcjson: JSON parsing
  // - libuv: Event loop and async I/O (timers, etc.)
  // - libm: Math functions
  // - tree-sitter: Incremental parsing (optional, for self-hosting)
  const mongooseObj = `${MONGOOSE_PATH}/mongoose.o`;

  // Build link command with all libraries
  let linkLibs = `-L${BDWGC_PATH} -lgc -lcurl -lcjson -l:libuv.so.1 -lm -lpthread`;
  let extraObjs = '';

  if (linkTreeSitter) {
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
      const compileParser = `clang -c -O2 -fPIC -I ${tsInclude} -I ${commonInclude} ${parserSrc} -o ${tsParserObj}`;
      logger.info(`  Compiling tree-sitter parser...`);
      execSync(compileParser, { stdio: 'pipe' });
    }

    if (!fs.existsSync(tsScannerObj)) {
      const scannerSrc = path.join(tsInclude, 'scanner.c');
      const compileScanner = `clang -c -O2 -fPIC -I ${tsInclude} -I ${commonInclude} ${scannerSrc} -o ${tsScannerObj}`;
      logger.info(`  Compiling tree-sitter scanner...`);
      execSync(compileScanner, { stdio: 'pipe' });
    }

    extraObjs = ` ${tsParserObj} ${tsScannerObj}`;
    linkLibs += ' /usr/lib64/libtree-sitter.so.0';
  }

  let linker = useClang ? 'clang' : 'gcc';
  if (sanitize) {
    linker = 'gcc';
  }
  const linkCmd = `${linker} ${objFile} ${mongooseObj}${extraObjs} -o ${outputFile} -no-pie${sanitizeFlags} ${linkLibs}`;
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
    try {
      fs.unlinkSync(irFile);
    } catch (e) {
      // File may already be deleted, ignore
    }
  }

  // Silent on success (like clang)
}

function compileMultiFile(entryFile: string, compiledFiles: Set<string>, fileContents: Map<string, string>, displayPath?: string): AST {
  const absPath = path.resolve(entryFile);

  if (compiledFiles.has(absPath)) {
    return { imports: [], functions: [], classes: [], exports: [], interfaces: [], typeAliases: [], enums: [], topLevelStatements: [], topLevelExpressions: [], topLevelItems: [], topLevelItemTypes: [] };
  }
  compiledFiles.add(absPath);

  logger.info(`  Parsing: ${absPath}`);
  const code = fs.readFileSync(absPath, 'utf8');
  fileContents.set(absPath, code);

  const pathForErrors = displayPath || absPath;

  let ast: AST;
  if (useTSParser) {
    logger.info(`  Using TypeScript API parser`);
    ast = parseWithTSAPI(code, { filename: pathForErrors });
  } else {
    const parser = new Parser(code, pathForErrors);
    ast = parser.parse();
  }

  let mergedAST: AST = {
    imports: ast.imports.slice(),
    functions: ast.functions.slice(),
    classes: ast.classes.slice(),
    exports: ast.exports.slice(),
    interfaces: ast.interfaces.slice(),
    typeAliases: ast.typeAliases?.slice() || [],
    enums: ast.enums?.slice() || [],
    topLevelStatements: ast.topLevelStatements.slice(),
    topLevelExpressions: ast.topLevelExpressions.slice(),
    topLevelItems: ast.topLevelItems?.slice() || [],
    topLevelItemTypes: ast.topLevelItemTypes?.slice() || []
  };

  let i = 0;
  while (i < ast.imports.length) {
    const imp = ast.imports[i];

    const isRelativeOrAbsolute = imp.source.startsWith('./') ||
                                   imp.source.startsWith('../') ||
                                   imp.source.startsWith('/');

    if (!isRelativeOrAbsolute) {
      const builtinModules = ['fs', 'path', 'child_process'];
      if (builtinModules.includes(imp.source)) {
        i = i + 1;
        continue;
      }

      const npmPath = resolveNodeModule(absPath, imp.source);
      if (npmPath) {
        const importedAST = compileMultiFile(npmPath, compiledFiles, fileContents);
        mergedAST.imports = mergedAST.imports.concat(importedAST.imports);
        mergedAST.functions = mergedAST.functions.concat(importedAST.functions);
        mergedAST.classes = mergedAST.classes.concat(importedAST.classes);
        mergedAST.interfaces = mergedAST.interfaces.concat(importedAST.interfaces);
        mergedAST.typeAliases = mergedAST.typeAliases.concat(importedAST.typeAliases || []);
        mergedAST.enums = mergedAST.enums.concat(importedAST.enums || []);
        mergedAST.topLevelStatements = mergedAST.topLevelStatements.concat(importedAST.topLevelStatements);
        i = i + 1;
        continue;
      }

      throw new Error(
        `Cannot resolve npm package '${imp.source}' imported in ${absPath}\n` +
        `Package not found in node_modules or missing TypeScript source.`
      );
    }

    const importPath = resolveImportPath(absPath, imp.source);
    const importedAST = compileMultiFile(importPath, compiledFiles, fileContents);

    mergedAST.imports = mergedAST.imports.concat(importedAST.imports);
    mergedAST.functions = mergedAST.functions.concat(importedAST.functions);
    mergedAST.classes = mergedAST.classes.concat(importedAST.classes);
    mergedAST.interfaces = mergedAST.interfaces.concat(importedAST.interfaces);
    mergedAST.typeAliases = mergedAST.typeAliases.concat(importedAST.typeAliases || []);
    mergedAST.enums = mergedAST.enums.concat(importedAST.enums || []);
    mergedAST.topLevelStatements = mergedAST.topLevelStatements.concat(importedAST.topLevelStatements);
    i = i + 1;
  }

  return mergedAST;
}

function resolveImportPath(fromFile: string, importSource: string): string {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir, importSource);

  // If the import has .js extension but file doesn't exist, try .ts
  if (importSource.endsWith('.js') && !fs.existsSync(resolved)) {
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
