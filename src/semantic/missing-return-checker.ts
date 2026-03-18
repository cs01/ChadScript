import type {
  AST,
  Statement,
  Expression,
  BlockStatement,
  IfStatement,
  SwitchStatement,
  WhileStatement,
  ForStatement,
  TryStatement,
  MethodCallNode,
  CallNode,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

function isLiteralTrue(expr: Expression): boolean {
  if (!expr) return false;
  if (expr.type === "boolean") {
    const b = expr as { type: string; value: boolean };
    return b.value === true;
  }
  return false;
}

function buildNeverNames(ast: AST): string[] {
  const names: string[] = [];
  names.push("process.exit");

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    if (fn.returnType === "never") {
      names.push(fn.name);
    }
  }

  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) {
      const method = cls.methods[j];
      if (method.returnType === "never") {
        names.push(method.name);
      }
    }
  }

  return names;
}

function hasNeverName(names: string[], name: string): boolean {
  for (let i = 0; i < names.length; i++) {
    if (names[i] === name) return true;
  }
  return false;
}

function isNeverReturning(stmt: Statement, neverNames: string[]): boolean {
  const s = stmt as { type: string };
  if (s.type === "method_call") {
    const mc = stmt as unknown as MethodCallNode;
    if (hasNeverName(neverNames, mc.method)) return true;
    if (mc.object && mc.object.type === "variable") {
      const obj = mc.object as { type: string; name: string };
      const fullName = obj.name + "." + mc.method;
      if (hasNeverName(neverNames, fullName)) return true;
    }
  }
  if (s.type === "call") {
    const call = stmt as unknown as CallNode;
    if (hasNeverName(neverNames, call.name)) return true;
  }
  return false;
}

function blockHasBreak(stmts: Statement[]): boolean {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i] as { type: string };
    if (s.type === "break") return true;
    if (s.type === "if") {
      const ifStmt = stmts[i] as IfStatement;
      if (blockHasBreak(ifStmt.thenBlock.statements)) return true;
      if (ifStmt.elseBlock && blockHasBreak(ifStmt.elseBlock.statements)) return true;
    }
  }
  return false;
}

function allPathsReturn(stmts: Statement[], neverNames: string[]): boolean {
  if (stmts.length === 0) return false;

  for (let i = stmts.length - 1; i >= 0; i--) {
    const stmt = stmts[i];
    const s = stmt as { type: string };
    const stype = s.type;

    if (stype === "return" || stype === "throw") return true;
    if (isNeverReturning(stmt, neverNames)) return true;

    if (stype === "if") {
      const ifStmt = stmt as IfStatement;
      if (!ifStmt.elseBlock) continue;
      const thenReturns = allPathsReturn(ifStmt.thenBlock.statements, neverNames);
      const elseReturns = allPathsReturn(ifStmt.elseBlock.statements, neverNames);
      if (thenReturns && elseReturns) return true;
      continue;
    }

    if (stype === "switch") {
      const switchStmt = stmt as SwitchStatement;
      let hasDefault = false;
      let allCasesReturn = true;
      for (let ci = 0; ci < switchStmt.cases.length; ci++) {
        const c = switchStmt.cases[ci];
        if (c.test === null) hasDefault = true;
        if (!allPathsReturn(c.consequent, neverNames)) {
          allCasesReturn = false;
        }
      }
      if (hasDefault && allCasesReturn) return true;
      continue;
    }

    if (stype === "while") {
      const whileStmt = stmt as WhileStatement;
      if (isLiteralTrue(whileStmt.condition) && !blockHasBreak(whileStmt.body.statements)) {
        return true;
      }
      continue;
    }

    if (stype === "for") {
      const forStmt = stmt as ForStatement;
      if (!forStmt.condition && !blockHasBreak(forStmt.body.statements)) {
        return true;
      }
      continue;
    }

    if (stype === "try") {
      const tryStmt = stmt as TryStatement;
      const tryReturns = allPathsReturn(tryStmt.tryBlock.statements, neverNames);
      if (tryReturns) {
        if (!tryStmt.catchBody || allPathsReturn(tryStmt.catchBody.statements, neverNames)) {
          return true;
        }
      }
      continue;
    }

    if (stype === "block") {
      const block = stmt as BlockStatement;
      if (allPathsReturn(block.statements, neverNames)) return true;
      continue;
    }
  }

  return false;
}

export function checkMissingReturns(ast: AST, sourceCode: string): void {
  const neverNames = buildNeverNames(ast);

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    if (fn.declare) continue;
    if (!fn.returnType || fn.returnType === "void" || fn.returnType === "never") continue;
    if (fn.async) continue;
    if (fn.returnType.indexOf("Promise") === 0) continue;
    if (!allPathsReturn(fn.body.statements, neverNames)) {
      const output = formatCompileError(
        sourceCode,
        "function '" + fn.name + "' does not return a value on all code paths",
        fn.loc,
        "add a return statement to all branches",
        [],
      );
      process.stderr.write(output);
      process.exit(1);
    }
  }

  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) {
      const method = cls.methods[j];
      if (method.isConstructor) continue;
      if (!method.returnType || method.returnType === "void" || method.returnType === "never")
        continue;
      if (!allPathsReturn(method.body.statements, neverNames)) {
        const output = formatCompileError(
          sourceCode,
          "method '" + cls.name + "." + method.name + "' does not return a value on all code paths",
          undefined,
          "add a return statement to all branches",
          [],
        );
        process.stderr.write(output);
        process.exit(1);
      }
    }
  }
}
