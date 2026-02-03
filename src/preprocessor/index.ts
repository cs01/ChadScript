import * as ts from 'typescript';

export interface PreprocessOptions {
  transpileGenerators?: boolean;
  transpileSpread?: boolean;
  transpileOptionalChaining?: boolean;
  transpileForOf?: boolean;
  transpileDestructuring?: boolean;
}

const defaultOptions: PreprocessOptions = {
  transpileGenerators: true,
  transpileSpread: false,
  transpileOptionalChaining: false,
  transpileForOf: false,
  transpileDestructuring: false,
};

export function preprocess(source: string, filename: string, options: PreprocessOptions = {}): string {
  const opts = { ...defaultOptions, ...options };

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2015,
    module: ts.ModuleKind.ESNext,
    removeComments: false,
    preserveConstEnums: true,
    declaration: false,
    noEmit: false,
  };

  if (opts.transpileGenerators) {
    compilerOptions.target = ts.ScriptTarget.ES5;
    compilerOptions.downlevelIteration = true;
  }

  const result = ts.transpileModule(source, {
    compilerOptions,
    fileName: filename,
    transformers: {
      before: [createTypeAnnotationPreserver()],
      after: [createTypeAnnotationRestorer()],
    },
  });

  return result.outputText;
}

function createTypeAnnotationPreserver(): ts.TransformerFactory<ts.SourceFile> {
  return (_context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      return sourceFile;
    };
  };
}

function createTypeAnnotationRestorer(): ts.TransformerFactory<ts.SourceFile> {
  return (_context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      return sourceFile;
    };
  };
}

export function hasGenerators(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    'check.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;

    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) {
      if (node.asteriskToken) {
        found = true;
        return;
      }
    }

    if (node.kind === ts.SyntaxKind.YieldExpression) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}
