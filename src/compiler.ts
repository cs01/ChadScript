import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Parser } from './parser/parser.js';
import { LLVMGenerator } from './codegen/llvm-generator.js';
import { AST, ImportDeclaration, FunctionNode, ExportDeclaration } from './ast/types.js';

// ============================================
// MAIN COMPILER DRIVER
// ============================================

export function compile(inputFile: string, outputFile: string): void {
  console.log(`Compiling ${inputFile}...`);

  // Parse all files (starting from entry point, following imports)
  const compiledFiles = new Set<string>();
  const mergedAST = compileMultiFile(inputFile, compiledFiles);

  console.log('Functions found:', mergedAST.functions.map(f => f.name).join(', '));
  if (mergedAST.entryPoint) {
    console.log('Entry point:', JSON.stringify(mergedAST.entryPoint));
  }

  // Generate LLVM IR
  const generator = new LLVMGenerator(mergedAST);
  const llvmIR = generator.generate();

  // Write IR to file
  const irFile = outputFile + '.ll';
  fs.writeFileSync(irFile, llvmIR);
  console.log(`Generated LLVM IR: ${irFile}`);

  // Compile IR to object file
  const objFile = outputFile + '.o';
  execSync(`llc -filetype=obj ${irFile} -o ${objFile}`, { stdio: 'inherit' });
  console.log(`Generated object file: ${objFile}`);

  // Link to executable (with PIE support for modern systems)
  execSync(`clang ${objFile} -o ${outputFile} -no-pie`, { stdio: 'inherit' });
  console.log(`Generated executable: ${outputFile}`);

  // Clean up intermediate files
  try {
    fs.unlinkSync(objFile);
  } catch (e) {
    // File may already be deleted, ignore
  }

  console.log(`✓ Compilation successful!`);
}

function compileMultiFile(entryFile: string, compiledFiles: Set<string>): AST {
  const absPath = path.resolve(entryFile);

  // Avoid circular imports
  if (compiledFiles.has(absPath)) {
    return { imports: [], functions: [], classes: [], exports: [], topLevelStatements: [], entryPoint: null };
  }
  compiledFiles.add(absPath);

  // Read and parse this file
  console.log(`  Parsing: ${absPath}`);
  const code = fs.readFileSync(absPath, 'utf8');
  const parser = new Parser(code);
  const ast = parser.parse();

  // Start with this file's AST
  let mergedAST: AST = {
    imports: [],
    functions: ast.functions.slice(),
    classes: ast.classes.slice(),
    exports: ast.exports.slice(),
    topLevelStatements: ast.topLevelStatements.slice(),
    entryPoint: ast.entryPoint
  };

  // Process imports - recursively compile imported files
  let i = 0;
  while (i < ast.imports.length) {
    const imp = ast.imports[i];
    // Skip built-in Node.js modules
    const builtinModules = ['fs', 'path', 'child_process'];
    if (builtinModules.includes(imp.source)) {
      i = i + 1;
      continue;
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
