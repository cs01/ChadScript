// Loop safety analysis for bounds-check elimination.
//
// Detects simple loop patterns where a counter variable is provably
// always in-bounds for an array access:
//
//   Pattern A: for (let i = 0; i < arr.length; i++) { ... arr[i] ... }
//   Pattern B: let i = 0; while (i < arr.length) { ... arr[i] ... i = i + 1 }
//   Pattern C: while (i < arr.length) { ... arr[i] ... i = i + k }  (k > 0 const)
//
// For each matched pattern we register the (indexVar, arrayVar) pair in the
// generator context so that `arr[i]` inside the loop body emits a fast-path
// GEP without the usual icmp/branch/assume bounds check sequence.
//
// Soundness rules (any of these fail -> bail out, keep the bounds check):
//   - index variable must only be incremented by a non-negative constant
//     inside the loop body
//   - array variable must not be reassigned, pushed to, popped from, spliced,
//     shifted, unshifted, sliced-back, or otherwise mutated inside the body
//   - the condition must be exactly `i < arr.length`

import {
  Expression,
  Statement,
  BlockStatement,
  WhileStatement,
  ForStatement,
  BinaryNode,
  MemberAccessNode,
  VariableNode,
  AssignmentStatement,
  MethodCallNode,
  IndexAccessAssignmentNode,
  IfStatement,
  ForOfStatement,
  SwitchStatement,
  DoWhileStatement,
  ReturnStatement,
  ThrowStatement,
  VariableDeclaration,
  CallNode,
  UnaryNode,
  IndexAccessNode,
  ConditionalExpressionNode,
  NumberNode,
} from "../../ast/types.js";

interface ExprBase {
  type: string;
}
interface StmtBase {
  type: string;
}

// Pattern descriptor: index variable name paired with its safe array name.
export interface SafeLoopPattern {
  indexName: string;
  arrayName: string;
}

function getVarName(expr: Expression): string | null {
  if ((expr as ExprBase).type !== "variable") return null;
  return (expr as VariableNode).name;
}

// Detects `arr.length` as a member access expression, returning `arr` name.
function extractLengthOf(expr: Expression): string | null {
  if ((expr as ExprBase).type !== "member_access") return null;
  const m = expr as MemberAccessNode;
  if (m.property !== "length") return null;
  return getVarName(m.object);
}

// Detects condition `i < arr.length` (strict less-than only).
function detectLengthBoundedCondition(cond: Expression): SafeLoopPattern | null {
  if ((cond as ExprBase).type !== "binary") return null;
  const bin = cond as BinaryNode;
  if (bin.op !== "<") return null;
  const idxName = getVarName(bin.left);
  if (!idxName) return null;
  const arrName = extractLengthOf(bin.right);
  if (!arrName) return null;
  return { indexName: idxName, arrayName: arrName };
}

// Detects `i = i + c` or `i = i + k` with non-negative c.
// Returns true if the assignment is a monotone forward increment of `varName`.
function isForwardIncrement(stmt: Statement, varName: string): boolean {
  if ((stmt as StmtBase).type !== "assignment") return false;
  const assign = stmt as AssignmentStatement;
  if (assign.name !== varName) return false;
  if ((assign.value as ExprBase).type !== "binary") return false;
  const bin = assign.value as BinaryNode;
  if (bin.op !== "+") return false;
  const leftIsVar = getVarName(bin.left) === varName;
  const rightIsVar = getVarName(bin.right) === varName;
  // Either i = i + X or i = X + i
  if (leftIsVar) {
    return isNonNegativeIncrement(bin.right);
  }
  if (rightIsVar) {
    return isNonNegativeIncrement(bin.left);
  }
  return false;
}

// Returns true if expr is a numeric literal >= 0.
function isNonNegativeIncrement(expr: Expression): boolean {
  if ((expr as ExprBase).type === "number") {
    const n = (expr as NumberNode).value;
    return n >= 0;
  }
  return false;
}

// Returns true if `expr` (assignment update clause for a for-loop) is a
// forward increment of `varName` such as `i++` or `i = i + 1`.
function isForUpdateIncrement(update: Statement | Expression | null, varName: string): boolean {
  if (!update) return false;
  const u = update as StmtBase;
  if (u.type === "assignment") {
    return isForwardIncrement(update as Statement, varName);
  }
  if (u.type === "unary") {
    const un = update as UnaryNode;
    if (un.op === "++" || un.op === "+=" || un.op === "postfix++" || un.op === "postfix+=") {
      return getVarName(un.operand) === varName;
    }
  }
  return false;
}

// Walk a block recursively and return true if it contains any statement that
// could invalidate the (indexName, arrayName) safety guarantee.
function bodyInvalidatesSafety(
  block: BlockStatement,
  indexName: string,
  arrayName: string,
): boolean {
  const stmts = block.statements;
  for (let i = 0; i < stmts.length; i++) {
    if (stmtInvalidatesSafety(stmts[i], indexName, arrayName)) return true;
  }
  return false;
}

function stmtInvalidatesSafety(stmt: Statement, indexName: string, arrayName: string): boolean {
  const t = (stmt as StmtBase).type;

  // Any write to the index variable must be a forward increment
  if (t === "assignment") {
    const a = stmt as AssignmentStatement;
    if (a.name === indexName) {
      if (!isForwardIncrement(stmt, indexName)) return true;
      return false;
    }
    if (a.name === arrayName) {
      // direct reassignment of the array variable — unsafe
      return true;
    }
    // Walk the RHS for expression-level mutations of array (push calls etc.)
    if (exprMutatesArray(a.value, arrayName)) return true;
    return false;
  }

  // index_access_assignment: `arr[idx] = val` — for numeric/string/object arrays
  // this does NOT change length, but to stay safe if the target is our array,
  // skip (we could keep accepting it for Uint8Array reads, but the index itself
  // needs checking).  Only bail if the array is OUR array AND the assignment
  // could overwrite a different slot than arr[i].
  if (t === "index_access_assignment") {
    const ia = stmt as IndexAccessAssignmentNode;
    const tgtName = getVarName(ia.object);
    if (tgtName === arrayName) {
      // length doesn't change, this is fine for bounds of OTHER indices
      // still walk value / index for method calls that mutate
      if (exprMutatesArray(ia.index, arrayName)) return true;
      if (exprMutatesArray(ia.value as Expression, arrayName)) return true;
      return false;
    }
    if (exprMutatesArray(ia.index, arrayName)) return true;
    if (exprMutatesArray(ia.value as Expression, arrayName)) return true;
    return false;
  }

  if (t === "variable_declaration") {
    const vd = stmt as VariableDeclaration;
    if (vd.name === indexName || vd.name === arrayName) return true;
    if (vd.value && exprMutatesArray(vd.value, arrayName)) return true;
    return false;
  }

  if (t === "if") {
    const ifs = stmt as IfStatement;
    if (exprMutatesArray(ifs.condition, arrayName)) return true;
    if (bodyInvalidatesSafety(ifs.thenBlock, indexName, arrayName)) return true;
    if (ifs.elseBlock && bodyInvalidatesSafety(ifs.elseBlock, indexName, arrayName)) return true;
    return false;
  }

  if (t === "while") {
    const w = stmt as WhileStatement;
    if (exprMutatesArray(w.condition, arrayName)) return true;
    if (bodyInvalidatesSafety(w.body, indexName, arrayName)) return true;
    return false;
  }

  if (t === "do_while") {
    const dw = stmt as DoWhileStatement;
    if (exprMutatesArray(dw.condition, arrayName)) return true;
    if (bodyInvalidatesSafety(dw.body, indexName, arrayName)) return true;
    return false;
  }

  if (t === "for") {
    const f = stmt as ForStatement;
    if (f.init && stmtInvalidatesSafety(f.init as Statement, indexName, arrayName)) return true;
    if (f.condition && exprMutatesArray(f.condition, arrayName)) return true;
    if (f.update) {
      const up = f.update as StmtBase;
      if (up.type === "assignment") {
        if (stmtInvalidatesSafety(f.update as Statement, indexName, arrayName)) return true;
      } else if (exprMutatesArray(f.update as Expression, arrayName)) {
        return true;
      }
    }
    if (bodyInvalidatesSafety(f.body, indexName, arrayName)) return true;
    return false;
  }

  if (t === "for_of") {
    const fo = stmt as ForOfStatement;
    if (fo.variableName === indexName || fo.variableName === arrayName) return true;
    if (exprMutatesArray(fo.iterable, arrayName)) return true;
    if (bodyInvalidatesSafety(fo.body, indexName, arrayName)) return true;
    return false;
  }

  if (t === "return") {
    const r = stmt as ReturnStatement;
    if (r.value && exprMutatesArray(r.value, arrayName)) return true;
    return false;
  }

  if (t === "throw") {
    const th = stmt as ThrowStatement;
    if (th.argument && exprMutatesArray(th.argument, arrayName)) return true;
    return false;
  }

  if (t === "block") {
    return bodyInvalidatesSafety(stmt as BlockStatement, indexName, arrayName);
  }

  if (t === "switch") {
    const sw = stmt as SwitchStatement;
    if (exprMutatesArray(sw.discriminant, arrayName)) return true;
    for (let i = 0; i < sw.cases.length; i++) {
      const cs = sw.cases[i];
      for (let j = 0; j < cs.consequent.length; j++) {
        if (stmtInvalidatesSafety(cs.consequent[j], indexName, arrayName)) return true;
      }
    }
    return false;
  }

  // Method calls used as statements: check for mutating methods.
  if (t === "method_call_statement" || t === "method_call") {
    if (exprMutatesArray(stmt as unknown as Expression, arrayName)) return true;
    return false;
  }

  // break/continue — safe.
  if (t === "break" || t === "continue") return false;

  // Unknown statement type — bail to be safe.
  return true;
}

const MUTATING_METHODS: string[] = [
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
];

function isMutatingMethod(name: string): boolean {
  for (let i = 0; i < MUTATING_METHODS.length; i++) {
    if (MUTATING_METHODS[i] === name) return true;
  }
  return false;
}

// Recursively walk an expression for any call that could mutate arrayName's length
// or any nested expression that itself mutates the array.
function exprMutatesArray(expr: Expression, arrayName: string): boolean {
  if (!expr) return false;
  const t = (expr as ExprBase).type;

  if (t === "method_call") {
    const mc = expr as MethodCallNode;
    const objName = getVarName(mc.object);
    if (objName === arrayName && isMutatingMethod(mc.method)) return true;
    if (exprMutatesArray(mc.object, arrayName)) return true;
    for (let i = 0; i < mc.args.length; i++) {
      if (exprMutatesArray(mc.args[i], arrayName)) return true;
    }
    return false;
  }

  if (t === "call") {
    const c = expr as CallNode;
    for (let i = 0; i < c.args.length; i++) {
      if (exprMutatesArray(c.args[i], arrayName)) return true;
    }
    return false;
  }

  if (t === "binary") {
    const b = expr as BinaryNode;
    return exprMutatesArray(b.left, arrayName) || exprMutatesArray(b.right, arrayName);
  }

  if (t === "unary") {
    const u = expr as UnaryNode;
    return exprMutatesArray(u.operand, arrayName);
  }

  if (t === "member_access") {
    const m = expr as MemberAccessNode;
    return exprMutatesArray(m.object, arrayName);
  }

  if (t === "index_access") {
    const ia = expr as IndexAccessNode;
    return exprMutatesArray(ia.object, arrayName) || exprMutatesArray(ia.index, arrayName);
  }

  if (t === "conditional") {
    const c = expr as ConditionalExpressionNode;
    return (
      exprMutatesArray(c.condition, arrayName) ||
      exprMutatesArray(c.consequent, arrayName) ||
      exprMutatesArray(c.alternate, arrayName)
    );
  }

  return false;
}

// Analyze a while statement. Returns the pattern if safe, null otherwise.
export function analyzeWhileSafety(whileStmt: WhileStatement): SafeLoopPattern | null {
  const pat = detectLengthBoundedCondition(whileStmt.condition);
  if (!pat) return null;

  // Body must contain a forward-increment of indexName as a statement
  // somewhere (not strict — just ensures termination is plausible).
  if (!bodyContainsForwardIncrement(whileStmt.body, pat.indexName)) return null;

  // Body must not invalidate safety.
  if (bodyInvalidatesSafety(whileStmt.body, pat.indexName, pat.arrayName)) return null;

  return pat;
}

function bodyContainsForwardIncrement(block: BlockStatement, varName: string): boolean {
  const stmts = block.statements;
  for (let i = 0; i < stmts.length; i++) {
    if (isForwardIncrement(stmts[i], varName)) return true;
  }
  return false;
}

// Analyze a for statement. Returns the pattern if safe, null otherwise.
export function analyzeForSafety(forStmt: ForStatement): SafeLoopPattern | null {
  if (!forStmt.condition) return null;
  const pat = detectLengthBoundedCondition(forStmt.condition);
  if (!pat) return null;

  // Update must be forward increment of indexName
  if (!isForUpdateIncrement(forStmt.update, pat.indexName)) return null;

  // Body must not invalidate safety (index var is updated in `update`, not body,
  // so we don't require body increment here — we still reject body-side updates
  // of the index).
  if (bodyInvalidatesSafety(forStmt.body, pat.indexName, pat.arrayName)) return null;

  return pat;
}
