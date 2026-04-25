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
  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    binWalkBlk(fn.body, sourceCode);
  }
  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) {
      const m = cls.methods[j];
      binWalkBlk(m.body, sourceCode);
    }
  }
}

// --- Argument count checker ---

class ArgCheckState {
  names: string[] = [];
  mins: number[] = [];
  maxes: number[] = [];
  aliasNames: string[] = [];
  aliasOriginals: string[] = [];
  src: string = "";
  dupNames: string[] = [];

  resolveName(name: string): string {
    for (let i = 0; i < this.aliasNames.length; i++) {
      if (this.aliasNames[i] === name) return this.aliasOriginals[i];
    }
    return name;
  }

  lookup(name: string): number {
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === name) return i;
    }
    return -1;
  }

  isDuplicate(name: string): boolean {
    for (let i = 0; i < this.dupNames.length; i++) {
      if (this.dupNames[i] === name) return true;
    }
    return false;
  }

  checkCall(name: string, argCount: number, loc: SourceLocation | undefined): void {
    const resolved = this.resolveName(name);
    if (this.isDuplicate(resolved)) return;
    const idx = this.lookup(resolved);
    if (idx < 0) return;
    const min = this.mins[idx];
    const max = this.maxes[idx];
    if (argCount < min) {
      process.stderr.write(
        formatCompileError(
          this.src,
          "function '" + name + "' expects at least " + min + " argument(s) but got " + argCount,
          loc,
          "check the function signature",
          [],
        ),
      );
      process.exit(1);
    }
    if (argCount > max) {
      process.stderr.write(
        formatCompileError(
          this.src,
          "function '" + name + "' expects at most " + max + " argument(s) but got " + argCount,
          loc,
          "check the function signature",
          [],
        ),
      );
      process.exit(1);
    }
  }

  hasSpread(args: Expression[]): boolean {
    for (let i = 0; i < args.length; i++) {
      if (args[i] && args[i].type === "spread_element") return true;
    }
    return false;
  }

  checkExpr(expr: Expression): void {
    if (!expr) return;
    if (expr.type === "call") {
      const c = expr as CallNode;
      if (!this.hasSpread(c.args)) this.checkCall(c.name, c.args.length, c.loc);
      for (let i = 0; i < c.args.length; i++) this.checkExpr(c.args[i]);
    } else if (expr.type === "binary") {
      const b = expr as BinaryNode;
      this.checkExpr(b.left);
      this.checkExpr(b.right);
    } else if (expr.type === "unary") {
      this.checkExpr((expr as UnaryNode).operand);
    } else if (expr.type === "conditional") {
      const c = expr as ConditionalExpressionNode;
      this.checkExpr(c.condition);
      this.checkExpr(c.consequent);
      this.checkExpr(c.alternate);
    } else if (expr.type === "method_call") {
      const mc = expr as MethodCallNode;
      if (mc.object) this.checkExpr(mc.object);
      for (let i = 0; i < mc.args.length; i++) this.checkExpr(mc.args[i]);
    }
  }

  walkStmt(stmt: Statement): void {
    const stype = (stmt as { type: string }).type;
    if (stype === "variable_declaration") {
      const d = stmt as VariableDeclaration;
      if (d.value) this.checkExpr(d.value as Expression);
    } else if (stype === "assignment") {
      this.checkExpr((stmt as AssignmentStatement).value);
    } else if (stype === "if") {
      const i = stmt as IfStatement;
      this.checkExpr(i.condition);
      this.walkBlk(i.thenBlock);
      if (i.elseBlock) this.walkBlk(i.elseBlock);
    } else if (stype === "while") {
      const w = stmt as WhileStatement;
      this.checkExpr(w.condition);
      this.walkBlk(w.body);
    } else if (stype === "do_while") {
      const d = stmt as DoWhileStatement;
      this.walkBlk(d.body);
      this.checkExpr(d.condition);
    } else if (stype === "for") {
      const f = stmt as ForStatement;
      if (f.init) this.walkStmt(f.init as Statement);
      if (f.condition) this.checkExpr(f.condition);
      if (f.update) {
        if ((f.update as { type: string }).type === "assignment")
          this.walkStmt(f.update as Statement);
        else this.checkExpr(f.update as Expression);
      }
      this.walkBlk(f.body);
    } else if (stype === "for_of") {
      const fo = stmt as ForOfStatement;
      this.checkExpr(fo.iterable);
      this.walkBlk(fo.body);
    } else if (stype === "try") {
      const t = stmt as TryStatement;
      this.walkBlk(t.tryBlock);
      if (t.catchBody) this.walkBlk(t.catchBody);
      if (t.finallyBlock) this.walkBlk(t.finallyBlock);
    } else if (stype === "switch") {
      const sw = stmt as SwitchStatement;
      this.checkExpr(sw.discriminant);
      for (let ci = 0; ci < sw.cases.length; ci++) {
        const c = sw.cases[ci];
        if (c.test) this.checkExpr(c.test as Expression);
        this.walkStmts(c.consequent);
      }
    } else if (stype === "return") {
      const r = stmt as ReturnStatement;
      if (r.value) this.checkExpr(r.value as Expression);
    } else if (stype === "throw") {
      this.checkExpr((stmt as ThrowStatement).argument);
    } else if (stype === "block") {
      this.walkBlk(stmt as BlockStatement);
    } else if (stype === "call") {
      const c = stmt as unknown as CallNode;
      if (!this.hasSpread(c.args)) this.checkCall(c.name, c.args.length, c.loc);
      for (let i = 0; i < c.args.length; i++) this.checkExpr(c.args[i]);
    } else if (stype === "method_call") {
      const mc = stmt as unknown as MethodCallNode;
      if (mc.object) this.checkExpr(mc.object);
      for (let i = 0; i < mc.args.length; i++) this.checkExpr(mc.args[i]);
    } else if (stype !== "break" && stype !== "continue") {
      this.checkExpr(stmt as Expression);
    }
  }

  walkStmts(stmts: Statement[]): void {
    for (let i = 0; i < stmts.length; i++) this.walkStmt(stmts[i]);
  }

  walkBlk(block: BlockStatement): void {
    this.walkStmts(block.statements);
  }
}

function argCountMin(fn: FunctionNode): number {
  if (!fn.parameters) return fn.params.length;
  let min = 0;
  for (let i = 0; i < fn.parameters.length; i++) {
    if (!fn.parameters[i].optional && !fn.parameters[i].defaultValue) min++;
    else break;
  }
  return min;
}

function argHasRest(fn: FunctionNode): boolean {
  for (let i = 0; i < fn.params.length; i++) {
    if (fn.params[i].indexOf("...") === 0) return true;
  }
  if (fn.parameters) {
    for (let i = 0; i < fn.parameters.length; i++) {
      if (fn.parameters[i].name.indexOf("...") === 0) return true;
    }
  }
  return false;
}

function argCountMax(fn: FunctionNode): number {
  if (!fn.parameters) return fn.params.length;
  return fn.parameters.length;
}

export function checkArgumentCounts(ast: AST, sourceCode: string): void {
  const state = new ArgCheckState();
  state.src = sourceCode;
  if (ast.importAliasNames) state.aliasNames = ast.importAliasNames;
  if (ast.importAliasOriginals) state.aliasOriginals = ast.importAliasOriginals;

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    const existingIdx = state.lookup(fn.name);
    if (existingIdx >= 0) {
      // Overload: merge min/max across all signatures so a caller passing
      // an arg count valid for ANY signature is accepted. Previously we
      // skipped duplicates entirely, leaving the arity constraints of the
      // first-seen signature as authoritative — which silently broke
      // 3-arg httpServe (only 2-arg overload's max=2 was kept). Without
      // this, the declared 3-arg form in chadscript.d.ts was unreachable.
      if (argHasRest(fn)) {
        // Rest params effectively unbound upper — drop constraint entirely.
        state.names.splice(existingIdx, 1);
        state.mins.splice(existingIdx, 1);
        state.maxes.splice(existingIdx, 1);
      } else {
        const newMin = argCountMin(fn);
        const newMax = argCountMax(fn);
        if (newMin < state.mins[existingIdx]) state.mins[existingIdx] = newMin;
        if (newMax > state.maxes[existingIdx]) state.maxes[existingIdx] = newMax;
      }
      continue;
    }
    if (argHasRest(fn)) continue;
    state.names.push(fn.name);
    state.mins.push(argCountMin(fn));
    state.maxes.push(argCountMax(fn));
  }

  const items = ast.topLevelItems;
  if (items) state.walkStmts(items as Statement[]);
  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    state.walkBlk(fn.body);
  }
  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) {
      const m = cls.methods[j];
      state.walkBlk(m.body);
    }
  }
}

function mrSkipReturnType(rt: string): boolean {
  if (rt === "void") return true;
  if (rt === "never") return true;
  if (rt.indexOf("Promise") === 0) return true;
  return false;
}

export function checkMissingReturns(ast: AST, sourceCode: string): void {
  const nn: string[] = ["process.exit"];
  const fnNames: string[] = [];
  const fnBodies: BlockStatement[] = [];
  const fnLocs: (SourceLocation | undefined)[] = [];

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    if (fn.returnType === "never") nn.push(fn.name);
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
    if (fn.async) continue;
    const rt = fn.returnType;
    if (!rt || rt.length === 0) continue;
    if (mrSkipReturnType(rt)) continue;
    fnNames.push(fn.name);
    fnBodies.push(fn.body);
    fnLocs.push(fn.loc);
  }

  for (let i = 0; i < fnNames.length; i++) {
    if (!mrAllReturn(fnBodies[i].statements, nn)) {
      process.stderr.write(
        formatCompileError(
          sourceCode,
          "function '" + fnNames[i] + "' does not return a value on all code paths",
          fnLocs[i],
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
      const mrt = method.returnType;
      if (!mrt) continue;
      if (mrSkipReturnType(mrt)) continue;
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
