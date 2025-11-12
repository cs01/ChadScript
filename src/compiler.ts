import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Parser } from './parser/parser.js';
import { LLVMGenerator } from './codegen/llvm-generator.js';
import { TypeChecker } from './typescript/type-checker.js';
import { SemanticAnalyzer } from './analysis/semantic-analyzer.js';
import { AST } from './ast/types.js';
import { LogLevel, logger } from './utils/logger.js';

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
  const mergedAST = compileMultiFile(inputFile, compiledFiles, inputFile);

  // Run semantic analysis to catch type errors early
  logger.info('Running semantic analysis...');
  const analyzer = new SemanticAnalyzer(mergedAST);
  const analysisSuccess = analyzer.analyze();

  if (!analysisSuccess) {
    const errorOutput = analyzer.formatErrors();
    console.error(errorOutput);
    throw new Error('Semantic analysis failed. Fix the errors above and try again.');
  }

  logger.info('✓ Semantic analysis passed');

  // Create TypeScript type checker if compiling a .ts file
  let typeChecker: TypeChecker | null = null;
  if (inputFile.endsWith('.ts')) {
    try {
      const code = fs.readFileSync(inputFile, 'utf8');
      typeChecker = new TypeChecker(inputFile, code);
    } catch (error) {
      logger.warn('Warning: Could not load TypeScript types: ' + error);
    }
  }

  // Generate LLVM IR
  const generator = new LLVMGenerator(mergedAST, typeChecker);
  const llvmIR = generator.generate();

  // Write IR to file
  const irFile = outputFile + '.ll';
  fs.writeFileSync(irFile, llvmIR);

  // Compile IR to object file
  const objFile = outputFile + '.o';
  const llcCmd = `llc -filetype=obj ${irFile} -o ${objFile}`;
  logger.info(` "${llcPath}" -filetype=obj ${irFile} -o ${objFile}`);
  const llcStdio = logger.getLevel() >= LogLevel.Verbose ? 'inherit' : 'pipe';
  execSync(llcCmd, { stdio: llcStdio });

  // Link to executable
  const linkCmd = `${useClang ? 'clang' : 'gcc'} ${objFile} -o ${outputFile} -no-pie -lcurl -lcjson -lm`;
  logger.info(` "${linkerPath}" ${objFile} -o ${outputFile} -no-pie -lcurl -lcjson -lm`);
  const linkStdio = logger.getLevel() >= LogLevel.Verbose ? 'inherit' : 'pipe';
  execSync(linkCmd, { stdio: linkStdio });

  // Clean up intermediate files
  try {
    fs.unlinkSync(objFile);
  } catch (e) {
    // File may already be deleted, ignore
  }

  // Silent on success (like clang)
}

function compileMultiFile(entryFile: string, compiledFiles: Set<string>, displayPath?: string): AST {
  const absPath = path.resolve(entryFile);

  // Avoid circular imports
  if (compiledFiles.has(absPath)) {
    return { imports: [], functions: [], classes: [], exports: [], topLevelStatements: [], topLevelExpressions: [] };
  }
  compiledFiles.add(absPath);

  // Read and parse this file
  logger.info(`  Parsing: ${absPath}`);
  const code = fs.readFileSync(absPath, 'utf8');

  // Note: We do NOT transpile TypeScript files anymore because our parser needs
  // to see the type annotations for class field declarations (e.g., argNames: string[])
  // The parser has built-in support to skip/handle TypeScript type annotations

  // Use displayPath for entry file (preserves relative/absolute as passed), absPath for imported files
  const pathForErrors = displayPath || absPath;
  const parser = new Parser(code, pathForErrors);
  const ast = parser.parse();

  // Start with this file's AST
  let mergedAST: AST = {
    imports: [],
    functions: ast.functions.slice(),
    classes: ast.classes.slice(),
    exports: ast.exports.slice(),
    topLevelStatements: ast.topLevelStatements.slice(),
    topLevelExpressions: ast.topLevelExpressions.slice()
  };

  // Process imports - recursively compile imported files
  let i = 0;
  while (i < ast.imports.length) {
    const imp = ast.imports[i];

    // Detect npm package imports (not relative/absolute paths)
    const isRelativeOrAbsolute = imp.source.startsWith('./') ||
                                   imp.source.startsWith('../') ||
                                   imp.source.startsWith('/');

    if (!isRelativeOrAbsolute) {
      // This is an npm package or built-in module
      const builtinModules = ['fs', 'path', 'child_process'];
      if (builtinModules.includes(imp.source)) {
        // Skip built-in Node.js modules (we can't compile these)
        i = i + 1;
        continue;
      }

      // Error on npm packages - we can't compile them
      throw new Error(
        `Cannot compile npm package '${imp.source}' imported in ${absPath}\n` +
        `ChadScript only supports compiling local files (use relative imports like './file.js')\n` +
        `npm packages are designed for Node.js runtime and cannot be AOT compiled to native code.`
      );
    }

    const importPath = resolveImportPath(absPath, imp.source);
    const importedAST = compileMultiFile(importPath, compiledFiles);

    // Merge functions, classes, and top-level statements from imported file
    mergedAST.functions = mergedAST.functions.concat(importedAST.functions);
    mergedAST.classes = mergedAST.classes.concat(importedAST.classes);
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
