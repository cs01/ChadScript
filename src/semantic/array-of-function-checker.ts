// Array-of-function-type checker.
//
// PROBLEM: `const arr: Array<() => number> = []` and `FnType[]` allocate as
// `%Array*` (number[]) because declaredType parsing doesn't recognize function
// types as elements. Codegen then stores function symbols (`__lambda_N`) into
// double slots, producing scary clang errors like
//   error: expected value token
//     store double __lambda_0, double* %43
//
// Supporting arrays of functions properly is a multi-day codegen project.
// Until that lands, detecting the pattern and emitting a friendly ChadScript
// compile error is strictly better than exposing raw LLVM errors to end users.

import type {
  AST,
  VariableDeclaration,
  FunctionNode,
  ClassNode,
  ClassField,
  ClassMethod,
  Statement,
  BlockStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  SourceLocation,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

export function checkArraysOfFunctions(ast: AST, sourceCode: string): void {
  const checker = new ArrayOfFunctionChecker(sourceCode);
  checker.check(ast);
}

class ArrayOfFunctionChecker {
  private sourceCode: string;

  constructor(sourceCode: string) {
    this.sourceCode = sourceCode;
  }

  private isArrayOfFunctionType(tsType: string): boolean {
    if (!tsType || tsType.length === 0) return false;
    const t = tsType.trim();
    if (t.startsWith("Array<") && t.endsWith(">")) {
      const inner = t.substring(6, t.length - 1).trim();
      if (inner.indexOf("=>") !== -1) return true;
    }
    if (t.endsWith("[]")) {
      const inner = t.substring(0, t.length - 2).trim();
      if (inner.indexOf("=>") !== -1) return true;
      if (inner === "Function") return true;
    }
    return false;
  }

  private reportError(declaredType: string, where: string, loc: SourceLocation | undefined): void {
    const out = formatCompileError(
      this.sourceCode,
      "arrays of function values are not supported yet (" +
        where +
        " declared as '" +
        declaredType +
        "')",
      loc,
      "store functions in individual named variables or use a class-based dispatcher:\n" +
        "  interface Handler { run(n: number): number }\n" +
        "  const handlers: Handler[] = [...];",
      [
        "arrays whose element type is a function type cannot be represented by the current codegen.",
        "proper support requires runtime function-pointer arrays and is tracked as a follow-up.",
      ],
    );
    process.stderr.write(out + "\n");
    process.exit(1);
  }

  check(ast: AST): void {
    if (ast.topLevelStatements) {
      for (const s of ast.topLevelStatements) this.checkTopLevelStmt(s);
    }
    if (ast.functions) {
      for (const f of ast.functions) this.checkFunction(f);
    }
    if (ast.classes) {
      for (const c of ast.classes) this.checkClass(c);
    }
  }

  private checkTopLevelStmt(stmt: VariableDeclaration | Statement): void {
    const t = (stmt as { type: string }).type;
    if (t === "variable_declaration") {
      const v = stmt as VariableDeclaration;
      if (v.declaredType && this.isArrayOfFunctionType(v.declaredType)) {
        this.reportError(v.declaredType, "variable '" + v.name + "'", v.loc);
      }
    }
  }

  private checkStatement(stmt: Statement): void {
    const t = (stmt as { type: string }).type;
    if (t === "variable_declaration") {
      const v = stmt as VariableDeclaration;
      if (v.declaredType && this.isArrayOfFunctionType(v.declaredType)) {
        this.reportError(v.declaredType, "variable '" + v.name + "'", v.loc);
      }
      return;
    }
    if (t === "block") {
      this.checkBlock(stmt as BlockStatement);
      return;
    }
    if (t === "if") {
      const i = stmt as IfStatement;
      this.checkBlock(i.thenBlock);
      if (i.elseBlock) this.checkBlock(i.elseBlock);
      return;
    }
    if (t === "while") {
      this.checkBlock((stmt as WhileStatement).body);
      return;
    }
    if (t === "do_while") {
      this.checkBlock((stmt as DoWhileStatement).body);
      return;
    }
    if (t === "for") {
      const f = stmt as ForStatement;
      if (f.init && (f.init as { type: string }).type === "variable_declaration") {
        const v = f.init as VariableDeclaration;
        if (v.declaredType && this.isArrayOfFunctionType(v.declaredType)) {
          this.reportError(v.declaredType, "variable '" + v.name + "'", v.loc);
        }
      }
      this.checkBlock(f.body);
      return;
    }
    if (t === "for_of") {
      this.checkBlock((stmt as ForOfStatement).body);
      return;
    }
    if (t === "try") {
      const tr = stmt as TryStatement;
      this.checkBlock(tr.tryBlock);
      if (tr.catchBody) this.checkBlock(tr.catchBody);
      if (tr.finallyBlock) this.checkBlock(tr.finallyBlock);
      return;
    }
    if (t === "switch") {
      const sw = stmt as SwitchStatement;
      if (sw.cases) {
        for (const c of sw.cases) {
          if (c.consequent) {
            for (const s of c.consequent) this.checkStatement(s);
          }
        }
      }
      return;
    }
  }

  private checkBlock(block: BlockStatement): void {
    if (!block || !block.statements) return;
    for (const s of block.statements) this.checkStatement(s);
  }

  private checkFunction(func: FunctionNode): void {
    if (func.parameters) {
      for (const p of func.parameters) {
        if (p.type && this.isArrayOfFunctionType(p.type)) {
          this.reportError(
            p.type,
            "parameter '" + p.name + "' in function '" + func.name + "'",
            func.loc,
          );
        }
      }
    }
    if (func.returnType && this.isArrayOfFunctionType(func.returnType)) {
      this.reportError(func.returnType, "return type of function '" + func.name + "'", func.loc);
    }
    if (func.body) this.checkBlock(func.body);
  }

  private checkClass(cls: ClassNode): void {
    if (cls.fields) {
      for (const f of cls.fields as ClassField[]) {
        const tsType = (f as { tsType?: string }).tsType;
        if (tsType && this.isArrayOfFunctionType(tsType)) {
          this.reportError(tsType, "field '" + f.name + "' on class '" + cls.name + "'", cls.loc);
        }
      }
    }
    if (cls.methods) {
      for (const m of cls.methods as ClassMethod[]) {
        if (m.parameters) {
          for (const p of m.parameters) {
            if (p.type && this.isArrayOfFunctionType(p.type)) {
              this.reportError(
                p.type,
                "parameter '" + p.name + "' in method '" + cls.name + "." + m.name + "'",
                cls.loc,
              );
            }
          }
        }
        if (m.returnType && this.isArrayOfFunctionType(m.returnType)) {
          this.reportError(
            m.returnType,
            "return type of method '" + cls.name + "." + m.name + "'",
            cls.loc,
          );
        }
        if (m.body) this.checkBlock(m.body);
      }
    }
  }
}
