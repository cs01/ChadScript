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
    return { imports: [], functions: [], classes: [], exports: [], entryPoint: null };
  }
  compiledFiles.add(absPath);

  // Read and parse this file
  const code = fs.readFileSync(absPath, 'utf8');
  const parser = new Parser(code);
  const ast = parser.parse();

  // Start with this file's AST
  let mergedAST: AST = {
    imports: [],
    functions: [...ast.functions],
    classes: [...ast.classes],
    exports: [...ast.exports],
    entryPoint: ast.entryPoint
  };

  // Process imports - recursively compile imported files
  for (const imp of ast.imports) {
    const importPath = resolveImportPath(absPath, imp.source);
    const importedAST = compileMultiFile(importPath, compiledFiles);

    // Merge functions and classes from imported file
    mergedAST.functions.push(...importedAST.functions);
    mergedAST.classes.push(...importedAST.classes);
  }

  return mergedAST;
}

function resolveImportPath(fromFile: string, importSource: string): string {
  const dir = path.dirname(fromFile);
  return path.resolve(dir, importSource);
}
