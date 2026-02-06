import { parseSource } from './parser-native/index.js';
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
  basename(p: string): string;
};

declare const process: {
  exit(code: number): void;
  argv: string[];
};

const BDWGC_PATH = './vendor/bdwgc';
const MONGOOSE_PATH = './vendor/mongoose';
const CHADSCRIPT_PATH = '.';

export function compileNative(inputFile: string, outputFile: string): void {
  console.log('ChadScript native compiler v0.1.0');
  console.log('Input file: ' + inputFile);

  const compiledFiles: string[] = [];
  console.log('About to call compileMultiFile...');
  const mergedAST = compileMultiFile(inputFile, compiledFiles);

  console.log('AST interfaces count: ' + mergedAST.interfaces.length);
  console.log('AST functions count: ' + mergedAST.functions.length);
  console.log('AST classes count: ' + mergedAST.classes.length);
  console.log('AST topLevelStatements count: ' + mergedAST.topLevelStatements.length);
  console.log('AST topLevelExpressions count: ' + mergedAST.topLevelExpressions.length);

  console.log('Skipping semantic analysis for native bootstrap...');
  // TODO: Re-enable semantic analysis when for-of on object arrays works
  // console.log('Running semantic analysis...');
  // const analyzer = new SemanticAnalyzer(mergedAST);
  // const analysisSuccess = analyzer.analyze();

  // if (!analysisSuccess) {
  //   const errorOutput = analyzer.formatErrors();
  //   console.log(errorOutput);
  //   process.exit(1);
  // }

  // console.log('Semantic analysis passed');

  console.log('About to create LLVMGenerator...');
  const generatorOptions: LLVMGeneratorOptions = {
    linkTreeSitter: true,
    sourceCode: '',
    filename: inputFile
  };
  console.log('Created options');
  const generator = new LLVMGenerator(mergedAST, null, generatorOptions);
  console.log('LLVMGenerator created, calling generate()...');
  const llvmIR = generator.generate();
  console.log('generate() done, IR length = ' + llvmIR.length);

  const irFile = outputFile + '.ll';
  fs.writeFileSync(irFile, llvmIR);

  const objFile = outputFile + '.o';
  const llcCmd = 'llc -filetype=obj ' + irFile + ' -o ' + objFile;
  console.log('Running: ' + llcCmd);
  child_process.execSync(llcCmd);

  const mongooseObj = MONGOOSE_PATH + '/mongoose.o';
  const treeSitterTs = CHADSCRIPT_PATH + '/build/tree-sitter-typescript-parser.o ' + CHADSCRIPT_PATH + '/build/tree-sitter-typescript-scanner.o';
  const linkLibs = '-L' + BDWGC_PATH + ' -lgc -lcurl -lcjson /lib64/libuv.so.1 -lm -lpthread /usr/lib64/libtree-sitter.so.0';
  const linkCmd = 'clang ' + objFile + ' ' + mongooseObj + ' ' + treeSitterTs + ' -o ' + outputFile + ' -no-pie ' + linkLibs;
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

function printUsage(): void {
  console.log('Usage: native-compiler [options] <input.ts> [output]');
  console.log('');
  console.log('Options:');
  console.log('  -o <output>               Specify output file');
  console.log('  --use-ts-parser           (ignored, tree-sitter always used)');
  console.log('  --link-tree-sitter        (ignored, always linked)');
  console.log('  --skip-semantic-analysis  Skip semantic analysis');
  console.log('  --help                    Show this help message');
}

const args = process.argv;

if (args.length < 1) {
  printUsage();
  process.exit(1);
}

let inputFile: string | null = null;
let outputFile: string | null = null;
let argIdx = 0;
while (argIdx < args.length) {
  const arg = args[argIdx];
  if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  } else if (arg === '--use-ts-parser') {
    argIdx = argIdx + 1;
  } else if (arg === '--link-tree-sitter') {
    argIdx = argIdx + 1;
  } else if (arg === '--skip-semantic-analysis') {
    argIdx = argIdx + 1;
  } else if (arg === '-o') {
    argIdx = argIdx + 1;
    if (argIdx < args.length) {
      outputFile = args[argIdx];
      argIdx = argIdx + 1;
    }
  } else if (arg.substr(0, 1) === '-') {
    console.log('Unknown option: ' + arg);
    printUsage();
    process.exit(1);
  } else if (inputFile === null) {
    inputFile = arg;
    argIdx = argIdx + 1;
  } else if (outputFile === null) {
    outputFile = arg;
    argIdx = argIdx + 1;
  } else {
    argIdx = argIdx + 1;
  }
}

if (inputFile === null) {
  console.log('Error: No input file specified');
  printUsage();
  process.exit(1);
  throw new Error('unreachable');
}

const theInputFile: string = inputFile;

if (!fs.existsSync(theInputFile)) {
  console.log('Error: File not found: ' + theInputFile);
  process.exit(1);
  throw new Error('unreachable');
}

let theOutputFile: string = '.build/' + path.basename(theInputFile);
if (outputFile !== null) {
  theOutputFile = outputFile;
} else if (theInputFile.substr(theInputFile.length - 3) === '.ts') {
  const base = path.basename(theInputFile);
  theOutputFile = '.build/' + base.substr(0, base.length - 3);
} else if (theInputFile.substr(theInputFile.length - 3) === '.js') {
  const base = path.basename(theInputFile);
  theOutputFile = '.build/' + base.substr(0, base.length - 3);
}

const outputDir = path.dirname(theOutputFile);
if (!fs.existsSync(outputDir)) {
  child_process.execSync('mkdir -p ' + outputDir);
}

compileNative(theInputFile, theOutputFile);
