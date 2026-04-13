// Detects functions that can be specialized to a pure-i64 ABI instead of
// the default double ABI. Eligible functions:
//  - All numeric params are integer-valued throughout the body
//  - Return type is `number` (or unspecified) and every return value is an
//    integer-shaped expression
//  - No closures, async, optional/default params, or non-numeric params
//  - Body has no try/throw/await/for-of/switch
//  - Body calls only itself (no foreign function or method calls)
//
// When marked `intSpecialized`, the function-generator emits an i64 signature
// (skipping the entry fptosi), and the call-site lowering passes/returns i64
// directly. All call sites already understand i64 paramTypes via the existing
// FFI coercion paths in calls.ts.
//
// IMPORTANT: this file runs under both the node and native compilers. To stay
// self-hosting safe we (a) only cast AST nodes to their canonical types from
// `src/ast/types.ts` (never to inline subset shapes — see CLAUDE.md rule #5),
// and (b) avoid `for...of`, `Set`, `Map`, etc.

import type {
  Statement,
  Expression,
  FunctionNode,
  AST,
  BinaryNode,
  UnaryNode,
  VariableNode,
  NumberNode,
  CallNode,
  MethodCallNode,
  NewNode,
  MemberAccessNode,
  IndexAccessNode,
  ArrayNode,
  ObjectNode,
  MapNode,
  SetNode,
  TemplateLiteralNode,
  ConditionalExpressionNode,
  AwaitExpressionNode,
  MemberAccessAssignmentNode,
  IndexAccessAssignmentNode,
  TypeAssertionNode,
  SpreadElementNode,
  ArrowFunctionNode,
  ReturnStatement,
  VariableDeclaration,
  AssignmentStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  ThrowStatement,
  TryStatement,
  SwitchStatement,
  BlockStatement,
} from "../../ast/types.js";
import { findI64EligibleVariables } from "./integer-analysis.js";

// ----------------------------------------------------------------------------
// Statement walkers — keep all logic in terms of the canonical AST types.
// ----------------------------------------------------------------------------

function bodyHasDisqualifyingStmt(stmts: Statement[]): boolean {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    const t = s.type;
    if (t === "try" || t === "throw" || t === "await" || t === "for_of" || t === "switch") {
      return true;
    }
    if (t === "if") {
      const ifS = s as IfStatement;
      if (bodyHasDisqualifyingStmt(ifS.thenBlock.statements)) return true;
      if (ifS.elseBlock && bodyHasDisqualifyingStmt(ifS.elseBlock.statements)) return true;
    } else if (t === "while" || t === "do_while") {
      const w = s as WhileStatement;
      if (bodyHasDisqualifyingStmt(w.body.statements)) return true;
    } else if (t === "for") {
      const f = s as ForStatement;
      if (bodyHasDisqualifyingStmt(f.body.statements)) return true;
    }
  }
  return false;
}

// Returns true if the expression contains a call to anything other than
// `selfName`, including method calls or any non-self function call. Self
// recursive calls are allowed; their args are walked recursively.
function exprHasForeignInvocation(e: Expression, selfName: string): boolean {
  const t = e.type;
  if (t === "call") {
    const c = e as CallNode;
    if (c.name !== selfName) return true;
    if (c.args) {
      for (let i = 0; i < c.args.length; i++) {
        if (exprHasForeignInvocation(c.args[i], selfName)) return true;
      }
    }
    return false;
  }
  if (t === "method_call") {
    return true;
  }
  if (t === "binary") {
    const b = e as BinaryNode;
    return (
      exprHasForeignInvocation(b.left, selfName) || exprHasForeignInvocation(b.right, selfName)
    );
  }
  if (t === "unary") {
    const u = e as UnaryNode;
    return exprHasForeignInvocation(u.operand, selfName);
  }
  return false;
}

function stmtsHaveForeignInvocation(stmts: Statement[], selfName: string): boolean {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    const t = s.type;
    if (t === "return") {
      const r = s as ReturnStatement;
      if (r.value && exprHasForeignInvocation(r.value, selfName)) return true;
    } else if (t === "variable_declaration") {
      const vd = s as VariableDeclaration;
      if (vd.value && exprHasForeignInvocation(vd.value, selfName)) return true;
    } else if (t === "assignment") {
      const a = s as AssignmentStatement;
      if (a.value && exprHasForeignInvocation(a.value, selfName)) return true;
    } else if (t === "if") {
      const ifS = s as IfStatement;
      if (stmtsHaveForeignInvocation(ifS.thenBlock.statements, selfName)) return true;
      if (ifS.elseBlock && stmtsHaveForeignInvocation(ifS.elseBlock.statements, selfName))
        return true;
    } else if (t === "while" || t === "do_while") {
      const w = s as WhileStatement;
      if (stmtsHaveForeignInvocation(w.body.statements, selfName)) return true;
    } else if (t === "for") {
      const f = s as ForStatement;
      if (stmtsHaveForeignInvocation(f.body.statements, selfName)) return true;
    }
  }
  return false;
}

// Returns true if every reachable return statement has an integer-shaped value.
// `eligibleNames` is the result of findI64EligibleVariables — i.e. locals/params
// that have already been proven to never receive a non-integer value.
function isIntegerShapedExpr(e: Expression, eligibleNames: string[], selfName: string): boolean {
  const t = e.type;
  if (t === "number") {
    return (e as NumberNode).value % 1 === 0;
  }
  if (t === "variable") {
    const name = (e as VariableNode).name;
    for (let i = 0; i < eligibleNames.length; i++) {
      if (eligibleNames[i] === name) return true;
    }
    return false;
  }
  if (t === "binary") {
    const b = e as BinaryNode;
    const op = b.op;
    if (
      op === "+" ||
      op === "-" ||
      op === "*" ||
      op === "%" ||
      op === "&" ||
      op === "|" ||
      op === "^" ||
      op === "<<" ||
      op === ">>" ||
      op === ">>>"
    ) {
      return (
        isIntegerShapedExpr(b.left, eligibleNames, selfName) &&
        isIntegerShapedExpr(b.right, eligibleNames, selfName)
      );
    }
    return false;
  }
  if (t === "unary") {
    const u = e as UnaryNode;
    if (u.op === "-" || u.op === "+" || u.op === "~") {
      return isIntegerShapedExpr(u.operand, eligibleNames, selfName);
    }
    return false;
  }
  if (t === "call") {
    const c = e as CallNode;
    if (c.name !== selfName) return false;
    if (!c.args) return true;
    for (let i = 0; i < c.args.length; i++) {
      if (!isIntegerShapedExpr(c.args[i], eligibleNames, selfName)) return false;
    }
    return true;
  }
  return false;
}

function collectReturnExprs(stmts: Statement[], out: Expression[]): boolean {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    const t = s.type;
    if (t === "return") {
      const r = s as ReturnStatement;
      if (!r.value) return false;
      out.push(r.value);
    } else if (t === "if") {
      const ifS = s as IfStatement;
      if (!collectReturnExprs(ifS.thenBlock.statements, out)) return false;
      if (ifS.elseBlock && !collectReturnExprs(ifS.elseBlock.statements, out)) return false;
    } else if (t === "while" || t === "do_while") {
      const w = s as WhileStatement;
      if (!collectReturnExprs(w.body.statements, out)) return false;
    } else if (t === "for") {
      const f = s as ForStatement;
      if (!collectReturnExprs(f.body.statements, out)) return false;
    }
  }
  return true;
}

// ----------------------------------------------------------------------------
// Eligibility check.
// ----------------------------------------------------------------------------

function isEligible(func: FunctionNode): boolean {
  if (func.async) return false;
  if (func.declare) return false;
  if (!func.params || func.params.length === 0) return false;
  if (!func.body || !func.body.statements) return false;

  // Reject any non-`number` declared param type.
  const paramTypes = func.paramTypes || [];
  for (let i = 0; i < func.params.length; i++) {
    const pt = paramTypes[i];
    if (pt && pt !== "number" && pt !== "") return false;
  }
  if (func.parameters) {
    for (let i = 0; i < func.parameters.length; i++) {
      const p = func.parameters[i];
      if (!p) continue;
      if (p.optional || p.defaultValue) return false;
      if (p.type && p.type !== "number" && p.type !== "") return false;
    }
  }

  // Reject any non-`number` return type.
  const rt = func.returnType || "";
  if (rt !== "" && rt !== "number") return false;

  // Reject statements we don't want to reason about.
  if (bodyHasDisqualifyingStmt(func.body.statements)) return false;

  // Reject any method call or non-self function call.
  if (stmtsHaveForeignInvocation(func.body.statements, func.name)) return false;

  // Run the existing per-variable integer analyzer; every param must come
  // back as eligible.
  const eligible = findI64EligibleVariables(func.body.statements, func.params);
  if (eligible.length < func.params.length) return false;
  for (let i = 0; i < func.params.length; i++) {
    let found = false;
    for (let j = 0; j < eligible.length; j++) {
      if (eligible[j] === func.params[i]) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  // Every return statement must produce an integer-shaped expression.
  const returns: Expression[] = [];
  if (!collectReturnExprs(func.body.statements, returns)) return false;
  if (returns.length === 0) return false;
  for (let i = 0; i < returns.length; i++) {
    if (!isIntegerShapedExpr(returns[i], eligible, func.name)) return false;
  }

  return true;
}

// ----------------------------------------------------------------------------
// Escape analysis — a function is "escaped" (ineligible for i64 ABI
// specialization) if its name appears as a first-class value anywhere in the
// program: as a callback arg, assigned to a local, returned, stored in an
// array/object literal, captured by a closure, etc. Such uses go through the
// canonical double-double function-pointer contract, so we must not mutate
// that signature. The ONLY non-escaping use is a direct call: `foo(a, b)` —
// where `foo` is `CallNode.name` (a string field, not a VariableNode).
//
// We collect the set of VariableNode names referenced anywhere in expression
// position, then intersect with top-level function names. The result is
// conservative: if a local variable shadows a function name, we treat it as
// escaped too, which just means we fail to specialize in a corner case.
// ----------------------------------------------------------------------------

function collectEscapedVarRefsExpr(e: Expression, out: string[]): void {
  const t = e.type;
  if (t === "variable") {
    out.push((e as VariableNode).name);
    return;
  }
  if (t === "call") {
    const c = e as CallNode;
    // c.name is a string (direct call target) — NOT a value reference.
    if (c.args) {
      for (let i = 0; i < c.args.length; i++) collectEscapedVarRefsExpr(c.args[i], out);
    }
    return;
  }
  if (t === "method_call") {
    const mc = e as MethodCallNode;
    // The method name is a string, but chad falls back to calling a
    // top-level function if no class method matches. That fallback path
    // uses the canonical double ABI, so if `mc.method` names a top-level
    // function, we must not specialize that function. Treat the method
    // name as a virtual escape reference. False positives are harmless —
    // they just prevent specialization when the receiver is actually a
    // class with its own method of the same name.
    out.push(mc.method);
    if (mc.object) collectEscapedVarRefsExpr(mc.object, out);
    if (mc.args) {
      for (let i = 0; i < mc.args.length; i++) collectEscapedVarRefsExpr(mc.args[i], out);
    }
    return;
  }
  if (t === "new") {
    const nn = e as NewNode;
    if (nn.args) {
      for (let i = 0; i < nn.args.length; i++) collectEscapedVarRefsExpr(nn.args[i], out);
    }
    return;
  }
  if (t === "binary") {
    const b = e as BinaryNode;
    collectEscapedVarRefsExpr(b.left, out);
    collectEscapedVarRefsExpr(b.right, out);
    return;
  }
  if (t === "unary") {
    const u = e as UnaryNode;
    collectEscapedVarRefsExpr(u.operand, out);
    return;
  }
  if (t === "member_access") {
    const ma = e as MemberAccessNode;
    collectEscapedVarRefsExpr(ma.object, out);
    return;
  }
  if (t === "index_access") {
    const ia = e as IndexAccessNode;
    collectEscapedVarRefsExpr(ia.object, out);
    collectEscapedVarRefsExpr(ia.index, out);
    return;
  }
  if (t === "array") {
    const a = e as ArrayNode;
    if (a.elements) {
      for (let i = 0; i < a.elements.length; i++) collectEscapedVarRefsExpr(a.elements[i], out);
    }
    return;
  }
  if (t === "object") {
    const o = e as ObjectNode;
    if (o.properties) {
      for (let i = 0; i < o.properties.length; i++) {
        collectEscapedVarRefsExpr(o.properties[i].value, out);
      }
    }
    return;
  }
  if (t === "map") {
    const m = e as MapNode;
    if (m.entries) {
      for (let i = 0; i < m.entries.length; i++) {
        collectEscapedVarRefsExpr(m.entries[i].key, out);
        collectEscapedVarRefsExpr(m.entries[i].value, out);
      }
    }
    return;
  }
  if (t === "set") {
    const s = e as SetNode;
    if (s.values) {
      for (let i = 0; i < s.values.length; i++) collectEscapedVarRefsExpr(s.values[i], out);
    }
    return;
  }
  if (t === "template_literal") {
    const tl = e as TemplateLiteralNode;
    if (tl.parts) {
      for (let i = 0; i < tl.parts.length; i++) {
        const p = tl.parts[i];
        if (typeof p !== "string") collectEscapedVarRefsExpr(p as Expression, out);
      }
    }
    return;
  }
  if (t === "conditional") {
    const ce = e as ConditionalExpressionNode;
    collectEscapedVarRefsExpr(ce.condition, out);
    collectEscapedVarRefsExpr(ce.consequent, out);
    collectEscapedVarRefsExpr(ce.alternate, out);
    return;
  }
  if (t === "await") {
    const aw = e as AwaitExpressionNode;
    collectEscapedVarRefsExpr(aw.argument, out);
    return;
  }
  if (t === "member_access_assignment") {
    const maa = e as MemberAccessAssignmentNode;
    collectEscapedVarRefsExpr(maa.object, out);
    collectEscapedVarRefsExpr(maa.value, out);
    return;
  }
  if (t === "index_access_assignment") {
    const iaa = e as IndexAccessAssignmentNode;
    collectEscapedVarRefsExpr(iaa.object, out);
    collectEscapedVarRefsExpr(iaa.index, out);
    collectEscapedVarRefsExpr(iaa.value, out);
    return;
  }
  if (t === "type_assertion") {
    const ta = e as TypeAssertionNode;
    collectEscapedVarRefsExpr(ta.expression, out);
    return;
  }
  if (t === "spread_element") {
    const sp = e as SpreadElementNode;
    collectEscapedVarRefsExpr(sp.argument, out);
    return;
  }
  if (t === "arrow_function") {
    const af = e as ArrowFunctionNode;
    const body = af.body;
    if (body && (body as BlockStatement).type === "block") {
      collectEscapedVarRefsStmts((body as BlockStatement).statements, out);
    } else if (body) {
      collectEscapedVarRefsExpr(body as Expression, out);
    }
    return;
  }
  // Leaves: number, string, boolean, null, undefined, regex, this, super — no children.
}

function collectEscapedVarRefsStmts(stmts: Statement[], out: string[]): void {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    const t = s.type;
    if (t === "variable_declaration") {
      const vd = s as VariableDeclaration;
      if (vd.value) collectEscapedVarRefsExpr(vd.value, out);
    } else if (t === "assignment") {
      const a = s as AssignmentStatement;
      if (a.value) collectEscapedVarRefsExpr(a.value, out);
    } else if (t === "return") {
      const r = s as ReturnStatement;
      if (r.value) collectEscapedVarRefsExpr(r.value, out);
    } else if (t === "if") {
      const ifS = s as IfStatement;
      collectEscapedVarRefsExpr(ifS.condition, out);
      collectEscapedVarRefsStmts(ifS.thenBlock.statements, out);
      if (ifS.elseBlock) collectEscapedVarRefsStmts(ifS.elseBlock.statements, out);
    } else if (t === "while") {
      const w = s as WhileStatement;
      collectEscapedVarRefsExpr(w.condition, out);
      collectEscapedVarRefsStmts(w.body.statements, out);
    } else if (t === "do_while") {
      const dw = s as DoWhileStatement;
      collectEscapedVarRefsExpr(dw.condition, out);
      collectEscapedVarRefsStmts(dw.body.statements, out);
    } else if (t === "for") {
      const f = s as ForStatement;
      if (f.init) {
        if ((f.init as VariableDeclaration).type === "variable_declaration") {
          const vd2 = f.init as VariableDeclaration;
          if (vd2.value) collectEscapedVarRefsExpr(vd2.value, out);
        } else {
          const as2 = f.init as AssignmentStatement;
          if (as2.value) collectEscapedVarRefsExpr(as2.value, out);
        }
      }
      if (f.condition) collectEscapedVarRefsExpr(f.condition, out);
      if (f.update) {
        const upType = (f.update as { type: string }).type;
        if (upType === "assignment") {
          const asu = f.update as AssignmentStatement;
          if (asu.value) collectEscapedVarRefsExpr(asu.value, out);
        } else {
          collectEscapedVarRefsExpr(f.update as Expression, out);
        }
      }
      collectEscapedVarRefsStmts(f.body.statements, out);
    } else if (t === "for_of") {
      const fo = s as ForOfStatement;
      collectEscapedVarRefsExpr(fo.iterable, out);
      collectEscapedVarRefsStmts(fo.body.statements, out);
    } else if (t === "throw") {
      const th = s as ThrowStatement;
      if (th.argument) collectEscapedVarRefsExpr(th.argument, out);
    } else if (t === "try") {
      const tr = s as TryStatement;
      collectEscapedVarRefsStmts(tr.tryBlock.statements, out);
      if (tr.catchBody) collectEscapedVarRefsStmts(tr.catchBody.statements, out);
      if (tr.finallyBlock) collectEscapedVarRefsStmts(tr.finallyBlock.statements, out);
    } else if (t === "switch") {
      const sw = s as SwitchStatement;
      collectEscapedVarRefsExpr(sw.discriminant, out);
      if (sw.cases) {
        for (let j = 0; j < sw.cases.length; j++) {
          const cs = sw.cases[j];
          if (cs.test) collectEscapedVarRefsExpr(cs.test, out);
          if (cs.consequent) collectEscapedVarRefsStmts(cs.consequent, out);
        }
      }
    } else if (t === "block") {
      const bl = s as BlockStatement;
      collectEscapedVarRefsStmts(bl.statements, out);
    } else {
      // Leftover case: a bare expression used as a statement (e.g. a call).
      collectEscapedVarRefsExpr(s as Expression, out);
    }
  }
}

function collectEscapedFunctionNames(ast: AST): string[] {
  const refs: string[] = [];

  const funcs = ast.functions;
  if (funcs) {
    for (let i = 0; i < funcs.length; i++) {
      const f = funcs[i] as FunctionNode;
      if (!f || !f.body || !f.body.statements) continue;
      collectEscapedVarRefsStmts(f.body.statements, refs);
    }
  }

  const classes = ast.classes;
  if (classes) {
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      if (!cls || !cls.methods) continue;
      for (let j = 0; j < cls.methods.length; j++) {
        const m = cls.methods[j];
        if (m && m.body && m.body.statements) {
          collectEscapedVarRefsStmts(m.body.statements, refs);
        }
      }
    }
  }

  if (ast.topLevelStatements) {
    for (let i = 0; i < ast.topLevelStatements.length; i++) {
      const s = ast.topLevelStatements[i];
      if (!s) continue;
      const t = s.type;
      if (t === "variable_declaration") {
        const vd = s as VariableDeclaration;
        if (vd.value) collectEscapedVarRefsExpr(vd.value, refs);
      } else if (t === "assignment") {
        const a = s as AssignmentStatement;
        if (a.value) collectEscapedVarRefsExpr(a.value, refs);
      }
    }
  }

  if (ast.topLevelExpressions) {
    for (let i = 0; i < ast.topLevelExpressions.length; i++) {
      const e = ast.topLevelExpressions[i];
      if (e) collectEscapedVarRefsExpr(e as Expression, refs);
    }
  }

  if (ast.topLevelItems) {
    for (let i = 0; i < ast.topLevelItems.length; i++) {
      const it = ast.topLevelItems[i];
      if (!it) continue;
      // Dispatch on shape — avoids needing to import every union type.
      const t = (it as { type: string }).type;
      if (t === "variable_declaration") {
        const vd = it as VariableDeclaration;
        if (vd.value) collectEscapedVarRefsExpr(vd.value, refs);
      } else if (t === "assignment") {
        const a = it as AssignmentStatement;
        if (a.value) collectEscapedVarRefsExpr(a.value, refs);
      } else if (
        t === "if" ||
        t === "while" ||
        t === "do_while" ||
        t === "for" ||
        t === "for_of" ||
        t === "try" ||
        t === "throw" ||
        t === "block" ||
        t === "switch" ||
        t === "return"
      ) {
        // Statements with nested expressions — reuse the stmt walker.
        collectEscapedVarRefsStmts([it as Statement], refs);
      } else {
        // Expression as a statement (call, new, method_call, await, ...).
        collectEscapedVarRefsExpr(it as Expression, refs);
      }
    }
  }

  return refs;
}

export function markIntSpecializedFunctions(ast: AST): void {
  const funcs = ast.functions;
  if (!funcs) return;

  // Build the set of function names referenced as first-class values.
  const escapedRefs = collectEscapedFunctionNames(ast);
  const funcNames: string[] = [];
  for (let i = 0; i < funcs.length; i++) {
    const f = funcs[i] as FunctionNode;
    if (f && f.name) funcNames.push(f.name);
  }
  const escapedFuncNames: string[] = [];
  for (let i = 0; i < funcNames.length; i++) {
    const name = funcNames[i];
    for (let j = 0; j < escapedRefs.length; j++) {
      if (escapedRefs[j] === name) {
        escapedFuncNames.push(name);
        break;
      }
    }
  }

  for (let i = 0; i < funcs.length; i++) {
    const f = funcs[i] as FunctionNode;
    if (!f) continue;

    // Reject if the function is ever referenced as a value.
    let escaped = false;
    for (let j = 0; j < escapedFuncNames.length; j++) {
      if (escapedFuncNames[j] === f.name) {
        escaped = true;
        break;
      }
    }
    if (escaped) continue;

    if (isEligible(f)) {
      f.intSpecialized = true;
    }
  }
}
