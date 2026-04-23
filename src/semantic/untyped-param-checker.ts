import type { AST, FunctionNode, ClassMethod, SourceLocation } from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

export function checkUntypedParams(ast: AST, sourceCode: string): void {
  const checker = new UntypedParamChecker(sourceCode);
  checker.check(ast);
}

class UntypedParamChecker {
  private sourceCode: string;

  constructor(sourceCode: string) {
    this.sourceCode = sourceCode;
  }

  check(ast: AST): void {
    for (let i = 0; i < ast.functions.length; i++) {
      this.checkFunction(ast.functions[i]);
    }

    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        this.checkMethod(cls.name, cls.methods[j]);
      }
    }
  }

  private checkFunction(fn: FunctionNode): void {
    if (fn.declare) return;
    if (!fn.params || fn.params.length === 0) return;

    for (let i = 0; i < fn.params.length; i++) {
      const paramName = fn.params[i];
      if (paramName === "...args") continue; // rest params
      const hasType =
        fn.paramTypes &&
        fn.paramTypes.length > i &&
        fn.paramTypes[i] !== null &&
        fn.paramTypes[i] !== undefined &&
        fn.paramTypes[i] !== "";
      if (!hasType) {
        this.report("function '" + fn.name + "'", paramName, fn.loc);
      }
    }
  }

  private checkMethod(className: string, method: ClassMethod): void {
    if (!method.params || method.params.length === 0) return;

    for (let i = 0; i < method.params.length; i++) {
      const paramName = method.params[i];
      if (paramName === "...args") continue;
      const hasType =
        method.paramTypes &&
        method.paramTypes.length > i &&
        method.paramTypes[i] !== null &&
        method.paramTypes[i] !== undefined &&
        method.paramTypes[i] !== "";
      if (!hasType) {
        this.report(className + "." + method.name + "()", paramName, undefined);
      }
    }
  }

  private report(context: string, paramName: string, loc: SourceLocation | undefined): void {
    const output = formatCompileError(
      this.sourceCode,
      "in " + context + ", parameter '" + paramName + "' has no type annotation",
      loc,
      "add a type annotation",
      ["'" + paramName + ": SomeType'"],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}
