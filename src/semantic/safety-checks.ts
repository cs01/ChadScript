import type {
  AST,
  Expression,
  Statement,
  CallNode,
  VariableDeclaration,
  AssignmentStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  ReturnStatement,
  ThrowStatement,
  BlockStatement,
  BinaryNode,
  VariableNode,
  UnaryNode,
  ConditionalExpressionNode,
  MethodCallNode,
  FunctionNode,
  SourceLocation,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

// --- Binary type checker (recursive walk into all scopes) ---

function inferBinType(expr: Expression): string {
  if (!expr) return "unknown";
  const t = expr.type;
  if (t === "number") return "number";
  if (t === "string") return "string";
  if (t === "boolean") return "boolean";
  if (t === "null" || t === "undefined") return "null";
  if (t === "array" || t === "object" || t === "new" || t === "regex") return "object";
  if (t === "template_literal") return "string";
  if (t === "variable") {
    const v = expr as VariableNode;
    if (v.name === "NaN" || v.name === "Infinity") return "number";
    return "unknown";
  }
  if (t === "unary") {
    const u = expr as UnaryNode;
    if (u.op === "!" || u.op === "typeof") return u.op === "typeof" ? "string" : "boolean";
    if (u.op === "-" || u.op === "+" || u.op === "~") return "number";
    return "unknown";
  }
  if (t === "binary") {
    const b = expr as BinaryNode;
    if (b.op === "===" || b.op === "!==" || b.op === "<" || b.op === ">") return "boolean";
    if (b.op === "-" || b.op === "*" || b.op === "/" || b.op === "%") return "number";
    if (b.op === "+") {
      const lt = inferBinType(b.left);
      if (lt === "string") return "string";
      const rt = inferBinType(b.right);
      if (rt === "string") return "string";
      if (lt === "number" && rt === "number") return "number";
    }
    return "unknown";
  }
  return "unknown";
}

function validateBinOp(b: BinaryNode, src: string): void {
  const lt = inferBinType(b.left);
  const rt = inferBinType(b.right);
  if (lt === "unknown" || rt === "unknown") return;
  const op = b.op;
  if (op === "===" || op === "!==" || op === "==" || op === "!=") return;
  if (op === "&&" || op === "||" || op === "??") return;
  if (op === "+") {
    if (lt === "string" || rt === "string") return;
    if (lt === "number" && rt === "number") return;
    const output = formatCompileError(
      src,
      "cannot use '+' between '" + lt + "' and '" + rt + "'",
      b.loc,
      "use explicit conversion if intended",
      [],
    );
    process.stderr.write(output);
    process.exit(1);
  }
  if (op === "-" || op === "*" || op === "/" || op === "%") {
    if (lt === "number" && rt === "number") return;
    const output = formatCompileError(
      src,
      "cannot use '" + op + "' between '" + lt + "' and '" + rt + "'",
      b.loc,
      "arithmetic operators require both operands to be numbers",
      [],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}

function checkBinExpr(expr: Expression, src: string): void {
  if (!expr) return;
  if (expr.type === "binary") {
    const b = expr as BinaryNode;
    checkBinExpr(b.left, src);
    checkBinExpr(b.right, src);
    validateBinOp(b, src);
  } else if (expr.type === "unary") {
    checkBinExpr((expr as UnaryNode).operand, src);
  } else if (expr.type === "conditional") {
    const c = expr as ConditionalExpressionNode;
    checkBinExpr(c.condition, src);
    checkBinExpr(c.consequent, src);
    checkBinExpr(c.alternate, src);
  }
}

function binWalkStmt(stmt: Statement, src: string): void {
  const stype = (stmt as { type: string }).type;
  if (stype === "variable_declaration") {
    const d = stmt as VariableDeclaration;
    if (d.value) checkBinExpr(d.value as Expression, src);
  } else if (stype === "assignment") {
    checkBinExpr((stmt as AssignmentStatement).value, src);
  } else if (stype === "if") {
    const i = stmt as IfStatement;
    checkBinExpr(i.condition, src);
    binWalkBlk(i.thenBlock, src);
    if (i.elseBlock) binWalkBlk(i.elseBlock, src);
  } else if (stype === "while") {
    const w = stmt as WhileStatement;
    checkBinExpr(w.condition, src);
    binWalkBlk(w.body, src);
  } else if (stype === "do_while") {
    const d = stmt as DoWhileStatement;
    binWalkBlk(d.body, src);
    checkBinExpr(d.condition, src);
  } else if (stype === "for") {
    const f = stmt as ForStatement;
    if (f.init) binWalkStmt(f.init as Statement, src);
    if (f.condition) checkBinExpr(f.condition, src);
    if (f.update) {
      if ((f.update as { type: string }).type === "assignment")
        binWalkStmt(f.update as Statement, src);
      else checkBinExpr(f.update as Expression, src);
    }
    binWalkBlk(f.body, src);
  } else if (stype === "for_of") {
    const fo = stmt as ForOfStatement;
    checkBinExpr(fo.iterable, src);
    binWalkBlk(fo.body, src);
  } else if (stype === "try") {
    const t = stmt as TryStatement;
    binWalkBlk(t.tryBlock, src);
    if (t.catchBody) binWalkBlk(t.catchBody, src);
    if (t.finallyBlock) binWalkBlk(t.finallyBlock, src);
  } else if (stype === "switch") {
    const sw = stmt as SwitchStatement;
    checkBinExpr(sw.discriminant, src);
    for (let ci = 0; ci < sw.cases.length; ci++) {
      const c = sw.cases[ci];
      if (c.test) checkBinExpr(c.test as Expression, src);
      binWalkStmts(c.consequent, src);
    }
  } else if (stype === "return") {
    const r = stmt as ReturnStatement;
    if (r.value) checkBinExpr(r.value as Expression, src);
  } else if (stype === "throw") {
    checkBinExpr((stmt as ThrowStatement).argument, src);
  } else if (stype === "block") {
    binWalkBlk(stmt as BlockStatement, src);
  } else if (stype !== "break" && stype !== "continue") {
    checkBinExpr(stmt as Expression, src);
  }
}

function binWalkStmts(stmts: Statement[], src: string): void {
  for (let i = 0; i < stmts.length; i++) binWalkStmt(stmts[i], src);
}

function binWalkBlk(block: BlockStatement, src: string): void {
  binWalkStmts(block.statements, src);
}

// --- Missing return checker ---

function mrIsLiteralTrue(expr: Expression): boolean {
  if (!expr) return false;
  if (expr.type === "boolean") return (expr as { type: string; value: boolean }).value === true;
  return false;
}

function mrHasBreak(stmts: Statement[]): boolean {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i] as { type: string };
    if (s.type === "break") return true;
    if (s.type === "if") {
      const ifS = stmts[i] as IfStatement;
      if (mrHasBreak(ifS.thenBlock.statements)) return true;
      if (ifS.elseBlock && mrHasBreak(ifS.elseBlock.statements)) return true;
    }
  }
  return false;
}

function mrIsNever(stmt: Statement, neverNames: string[]): boolean {
  const s = stmt as { type: string };
  if (s.type === "method_call") {
    const mc = stmt as unknown as MethodCallNode;
    for (let i = 0; i < neverNames.length; i++) {
      if (neverNames[i] === mc.method) return true;
    }
    if (mc.object && mc.object.type === "variable") {
      const obj = mc.object as { type: string; name: string };
      const full = obj.name + "." + mc.method;
      for (let i = 0; i < neverNames.length; i++) {
        if (neverNames[i] === full) return true;
      }
    }
  }
  if (s.type === "call") {
    const call = stmt as unknown as CallNode;
    for (let i = 0; i < neverNames.length; i++) {
      if (neverNames[i] === call.name) return true;
    }
  }
  return false;
}

function mrAllReturn(stmts: Statement[], nn: string[]): boolean {
  if (stmts.length === 0) return false;
  for (let i = stmts.length - 1; i >= 0; i--) {
    const stmt = stmts[i];
    const stype = (stmt as { type: string }).type;
    if (stype === "return" || stype === "throw") return true;
    if (mrIsNever(stmt, nn)) return true;
    if (stype === "if") {
      const ifS = stmt as IfStatement;
      if (!ifS.elseBlock) continue;
      if (mrAllReturn(ifS.thenBlock.statements, nn) && mrAllReturn(ifS.elseBlock.statements, nn))
        return true;
      continue;
    }
    if (stype === "switch") {
      const sw = stmt as SwitchStatement;
      let hasDef = false;
      let allRet = true;
      for (let ci = 0; ci < sw.cases.length; ci++) {
        if (sw.cases[ci].test === null) hasDef = true;
        if (!mrAllReturn(sw.cases[ci].consequent, nn)) allRet = false;
      }
      if (hasDef && allRet) return true;
      continue;
    }
    if (stype === "while") {
      const w = stmt as WhileStatement;
      if (mrIsLiteralTrue(w.condition) && !mrHasBreak(w.body.statements)) return true;
      continue;
    }
    if (stype === "for") {
      const f = stmt as ForStatement;
      if (!f.condition && !mrHasBreak(f.body.statements)) return true;
      continue;
    }
    if (stype === "try") {
      const t = stmt as TryStatement;
      if (
        mrAllReturn(t.tryBlock.statements, nn) &&
        (!t.catchBody || mrAllReturn(t.catchBody.statements, nn))
      )
        return true;
      continue;
    }
    if (stype === "block") {
      if (mrAllReturn((stmt as BlockStatement).statements, nn)) return true;
      continue;
    }
  }
  return false;
}

// --- Exports ---

export function checkBinaryTypesDeep(ast: AST, sourceCode: string): void {
  const items = ast.topLevelItems;
  if (items) binWalkStmts(items as Statement[], sourceCode);
  for (let i = 0; i < ast.functions.length; i++) binWalkBlk(ast.functions[i].body, sourceCode);
  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) binWalkBlk(cls.methods[j].body, sourceCode);
  }
}

// --- Argument count checker ---
// Module-level vars to avoid 5+ param functions (native compiler infinite loop workaround)

let argNames: string[] = [];
let argMins: number[] = [];
let argMaxes: number[] = [];
let argAliasNames: string[] = [];
let argAliasOriginals: string[] = [];
let argSrc: string = "";

function argResolveName(name: string): string {
  for (let i = 0; i < argAliasNames.length; i++) {
    if (argAliasNames[i] === name) return argAliasOriginals[i];
  }
  return name;
}

function argLookup(name: string): number {
  for (let i = 0; i < argNames.length; i++) {
    if (argNames[i] === name) return i;
  }
  return -1;
}

function argCheckCall(name: string, argCount: number, loc: SourceLocation | undefined): void {
  const resolved = argResolveName(name);
  const idx = argLookup(resolved);
  if (idx < 0) return;
  const min = argMins[idx];
  const max = argMaxes[idx];
  if (argCount < min) {
    process.stderr.write(
      formatCompileError(
        argSrc,
        "function '" + name + "' expects at least " + min + " argument(s) but got " + argCount,
        loc as SourceLocation | undefined,
        "check the function signature",
        [],
      ),
    );
    process.exit(1);
  }
  if (argCount > max) {
    process.stderr.write(
      formatCompileError(
        argSrc,
        "function '" + name + "' expects at most " + max + " argument(s) but got " + argCount,
        loc as SourceLocation | undefined,
        "check the function signature",
        [],
      ),
    );
    process.exit(1);
  }
}

function argCheckExpr(expr: Expression): void {
  if (!expr) return;
  if (expr.type === "call") {
    const c = expr as CallNode;
    argCheckCall(c.name, c.args.length, c.loc);
    for (let i = 0; i < c.args.length; i++) argCheckExpr(c.args[i]);
  } else if (expr.type === "binary") {
    const b = expr as BinaryNode;
    argCheckExpr(b.left);
    argCheckExpr(b.right);
  } else if (expr.type === "unary") {
    argCheckExpr((expr as UnaryNode).operand);
  } else if (expr.type === "conditional") {
    const c = expr as ConditionalExpressionNode;
    argCheckExpr(c.condition);
    argCheckExpr(c.consequent);
    argCheckExpr(c.alternate);
  } else if (expr.type === "method_call") {
    const mc = expr as MethodCallNode;
    if (mc.object) argCheckExpr(mc.object);
    for (let i = 0; i < mc.args.length; i++) argCheckExpr(mc.args[i]);
  }
}

function argWalkStmt(stmt: Statement): void {
  const stype = (stmt as { type: string }).type;
  if (stype === "variable_declaration") {
    const d = stmt as VariableDeclaration;
    if (d.value) argCheckExpr(d.value as Expression);
  } else if (stype === "assignment") {
    argCheckExpr((stmt as AssignmentStatement).value);
  } else if (stype === "if") {
    const i = stmt as IfStatement;
    argCheckExpr(i.condition);
    argWalkBlk(i.thenBlock);
    if (i.elseBlock) argWalkBlk(i.elseBlock);
  } else if (stype === "while") {
    const w = stmt as WhileStatement;
    argCheckExpr(w.condition);
    argWalkBlk(w.body);
  } else if (stype === "do_while") {
    const d = stmt as DoWhileStatement;
    argWalkBlk(d.body);
    argCheckExpr(d.condition);
  } else if (stype === "for") {
    const f = stmt as ForStatement;
    if (f.init) argWalkStmt(f.init as Statement);
    if (f.condition) argCheckExpr(f.condition);
    if (f.update) {
      if ((f.update as { type: string }).type === "assignment") argWalkStmt(f.update as Statement);
      else argCheckExpr(f.update as Expression);
    }
    argWalkBlk(f.body);
  } else if (stype === "for_of") {
    const fo = stmt as ForOfStatement;
    argCheckExpr(fo.iterable);
    argWalkBlk(fo.body);
  } else if (stype === "try") {
    const t = stmt as TryStatement;
    argWalkBlk(t.tryBlock);
    if (t.catchBody) argWalkBlk(t.catchBody);
    if (t.finallyBlock) argWalkBlk(t.finallyBlock);
  } else if (stype === "switch") {
    const sw = stmt as SwitchStatement;
    argCheckExpr(sw.discriminant);
    for (let ci = 0; ci < sw.cases.length; ci++) {
      const c = sw.cases[ci];
      if (c.test) argCheckExpr(c.test as Expression);
      argWalkStmts(c.consequent);
    }
  } else if (stype === "return") {
    const r = stmt as ReturnStatement;
    if (r.value) argCheckExpr(r.value as Expression);
  } else if (stype === "throw") {
    argCheckExpr((stmt as ThrowStatement).argument);
  } else if (stype === "block") {
    argWalkBlk(stmt as BlockStatement);
  } else if (stype === "call") {
    const c = stmt as unknown as CallNode;
    argCheckCall(c.name, c.args.length, c.loc);
    for (let i = 0; i < c.args.length; i++) argCheckExpr(c.args[i]);
  } else if (stype === "method_call") {
    const mc = stmt as unknown as MethodCallNode;
    if (mc.object) argCheckExpr(mc.object);
    for (let i = 0; i < mc.args.length; i++) argCheckExpr(mc.args[i]);
  } else if (stype !== "break" && stype !== "continue") {
    argCheckExpr(stmt as Expression);
  }
}

function argWalkStmts(stmts: Statement[]): void {
  for (let i = 0; i < stmts.length; i++) argWalkStmt(stmts[i]);
}

function argWalkBlk(block: BlockStatement): void {
  argWalkStmts(block.statements);
}

function argCountParams(fn: FunctionNode): { min: number; max: number } {
  if (!fn.parameters) return { min: fn.params.length, max: fn.params.length };
  let min = 0;
  const max = fn.parameters.length;
  for (let i = 0; i < fn.parameters.length; i++) {
    if (!fn.parameters[i].optional && !fn.parameters[i].defaultValue) min++;
    else break;
  }
  return { min, max };
}

export function checkArgumentCounts(ast: AST, sourceCode: string): void {
  argNames = [];
  argMins = [];
  argMaxes = [];
  argAliasNames = ast.importAliasNames ? ast.importAliasNames : [];
  argAliasOriginals = ast.importAliasOriginals ? ast.importAliasOriginals : [];
  argSrc = sourceCode;

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    const existing = argLookup(fn.name);
    if (existing >= 0) {
      argNames.splice(existing, 1);
      argMins.splice(existing, 1);
      argMaxes.splice(existing, 1);
      continue;
    }
    const counts = argCountParams(fn);
    argNames.push(fn.name);
    argMins.push(counts.min);
    argMaxes.push(counts.max);
  }

  const items = ast.topLevelItems;
  if (items) argWalkStmts(items as Statement[]);
  for (let i = 0; i < ast.functions.length; i++) argWalkBlk(ast.functions[i].body);
  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) argWalkBlk(cls.methods[j].body);
  }
}

export function checkMissingReturns(ast: AST, sourceCode: string): void {
  const nn: string[] = ["process.exit"];
  for (let i = 0; i < ast.functions.length; i++) {
    if (ast.functions[i].returnType === "never") nn.push(ast.functions[i].name);
  }
  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) {
      if (cls.methods[j].returnType === "never") nn.push(cls.methods[j].name);
    }
  }

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    if (fn.declare) continue;
    if (!fn.returnType || fn.returnType === "void" || fn.returnType === "never") continue;
    if (fn.async) continue;
    if (fn.returnType.indexOf("Promise") === 0) continue;
    if (!mrAllReturn(fn.body.statements, nn)) {
      process.stderr.write(
        formatCompileError(
          sourceCode,
          "function '" + fn.name + "' does not return a value on all code paths",
          fn.loc,
          "add a return statement to all branches",
          [],
        ),
      );
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
      if (!mrAllReturn(method.body.statements, nn)) {
        process.stderr.write(
          formatCompileError(
            sourceCode,
            "method '" +
              cls.name +
              "." +
              method.name +
              "' does not return a value on all code paths",
            undefined,
            "add a return statement to all branches",
            [],
          ),
        );
        process.exit(1);
      }
    }
  }
}
