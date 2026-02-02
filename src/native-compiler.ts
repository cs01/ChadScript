import { parseSource, TreeSitterTree } from './parser-native/index.js';
import { transformTree } from './parser-native/transformer.js';
import { LLVMGenerator, LLVMGeneratorOptions } from './codegen/llvm-generator.js';
import { SemanticAnalyzer } from './analysis/semantic-analyzer.js';
import { AST, ImportDeclaration } from './ast/types.js';

declare const child_process: {
  execSync(command: string): number;
};

declare const fs: {
  readFileSync(filename: string): string;
  writeFileSync(filename: string, data: string): number;
  existsSync(filename: string): boolean;
  unlinkSync(filename: string): number;
};

declare const path: {
  resolve(p: string): string;
  dirname(p: string): string;
};

const BDWGC_PATH = '/data/users/cssmith/git/bdwgc';
const MONGOOSE_PATH = '/data/users/cssmith/git/mongoose';

export function compileNative(inputFile: string, outputFile: string): void {
  console.log('ChadScript native compiler v0.1.0');

  const compiledFiles: string[] = [];
  const mergedAST = compileMultiFile(inputFile, compiledFiles);

  console.log('Running semantic analysis...');
  const analyzer = new SemanticAnalyzer(mergedAST);
  const analysisSuccess = analyzer.analyze();

  if (!analysisSuccess) {
    const errorOutput = analyzer.formatErrors();
    console.log(errorOutput);
    process.exit(1);
  }

  console.log('Semantic analysis passed');

  const generatorOptions: LLVMGeneratorOptions = { linkTreeSitter: true };
  const generator = new LLVMGenerator(mergedAST, null, generatorOptions);
  const llvmIR = generator.generate();

  const irFile = outputFile + '.ll';
  fs.writeFileSync(irFile, llvmIR);

  const objFile = outputFile + '.o';
  const llcCmd = 'llc -filetype=obj ' + irFile + ' -o ' + objFile;
  console.log('Running: ' + llcCmd);
  child_process.execSync(llcCmd);

  const mongooseObj = MONGOOSE_PATH + '/mongoose.o';
  const linkLibs = '-L' + BDWGC_PATH + ' -lgc -lcurl -lcjson /lib64/libuv.so.1 -lm -lpthread /usr/lib64/libtree-sitter.so.0';
  const linkCmd = 'clang ' + objFile + ' ' + mongooseObj + ' -o ' + outputFile + ' -no-pie ' + linkLibs;
  console.log('Running: ' + linkCmd);
  child_process.execSync(linkCmd);

  fs.unlinkSync(objFile);
  console.log('Compiled: ' + outputFile);
}

function compileMultiFile(entryFile: string, compiledFiles: string[]): AST {
  const absPath = path.resolve(entryFile);

  for (let i = 0; i < compiledFiles.length; i++) {
    if (compiledFiles[i] === absPath) {
      return emptyAST();
    }
  }
  compiledFiles.push(absPath);

  console.log('Parsing: ' + absPath);
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
    topLevelItems: ast.topLevelItems ? ast.topLevelItems.slice(0) : []
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
    mergedAST.topLevelStatements = mergedAST.topLevelStatements.concat(importedAST.topLevelStatements);
    i = i + 1;
  }

  return mergedAST;
}

function resolveImportPath(fromFile: string, importSource: string): string {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir + '/' + importSource);

  if (importSource.substr(importSource.length - 3) === '.js') {
    if (!fs.existsSync(resolved)) {
      const tsPath = resolved.substr(0, resolved.length - 3) + '.ts';
      if (fs.existsSync(tsPath)) {
        return tsPath;
      }
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

function emptyAST(): AST {
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
    topLevelItems: []
  };
}

const args = process.argv;
if (args.length < 2) {
  console.log('Usage: native-compiler <input.ts> [output]');
  process.exit(1);
}

const inputFile = args[0];
const outputFile = args.length > 1 ? args[1] : inputFile.substr(0, inputFile.length - 3);

compileNative(inputFile, outputFile);
