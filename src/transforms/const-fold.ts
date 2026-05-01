import type { HIRModule, HIRExpr, HIRStmt, HIRFunction } from "../hir/types.js";

function foldExpr(expr: HIRExpr): HIRExpr {
  switch (expr.kind) {
    case "binary": {
      const left = foldExpr(expr.left);
      const right = foldExpr(expr.right);
      if (left.kind === "literal_f64" && right.kind === "literal_f64") {
        const result = evalNumBinary(expr.op, left.value, right.value);
        if (result !== undefined) {
          if (typeof result === "boolean") {
            return { kind: "literal_i1", value: result, type: { kind: "i1" } };
          }
          return { kind: "literal_f64", value: result, type: { kind: "f64" } };
        }
      }
      if (left.kind === "literal_i64" && right.kind === "literal_i64") {
        const result = evalIntBinary(expr.op, left.value, right.value);
        if (result !== undefined) {
          if (typeof result === "boolean") {
            return { kind: "literal_i1", value: result, type: { kind: "i1" } };
          }
          return { kind: "literal_i64", value: result, type: { kind: "i64" } };
        }
      }
      if (left.kind === "literal_string" && right.kind === "literal_string") {
        if (expr.op === "add") {
          return { kind: "literal_string", value: left.value + right.value, type: { kind: "i8ptr" } };
        }
        if (expr.op === "eq") {
          return { kind: "literal_i1", value: left.value === right.value, type: { kind: "i1" } };
        }
        if (expr.op === "ne") {
          return { kind: "literal_i1", value: left.value !== right.value, type: { kind: "i1" } };
        }
      }
      if (left.kind === "literal_i1" && right.kind === "literal_i1") {
        if (expr.op === "and") return { kind: "literal_i1", value: left.value && right.value, type: { kind: "i1" } };
        if (expr.op === "or") return { kind: "literal_i1", value: left.value || right.value, type: { kind: "i1" } };
      }
      return { ...expr, left, right };
    }
    case "unary": {
      const operand = foldExpr(expr.operand);
      if (operand.kind === "literal_f64" && expr.op === "neg") {
        return { kind: "literal_f64", value: -operand.value, type: { kind: "f64" } };
      }
      if (operand.kind === "literal_i64" && expr.op === "neg") {
        return { kind: "literal_i64", value: -operand.value, type: { kind: "i64" } };
      }
      if (operand.kind === "literal_i1" && expr.op === "not") {
        return { kind: "literal_i1", value: !operand.value, type: { kind: "i1" } };
      }
      return { ...expr, operand };
    }
    case "conditional": {
      const condition = foldExpr(expr.condition);
      const thenExpr = foldExpr(expr.then);
      const elseExpr = foldExpr(expr.else);
      if (condition.kind === "literal_i1") {
        return condition.value ? thenExpr : elseExpr;
      }
      return { ...expr, condition, then: thenExpr, else: elseExpr };
    }
    default:
      return expr;
  }
}

function evalNumBinary(op: string, a: number, b: number): number | boolean | undefined {
  switch (op) {
    case "add": return a + b;
    case "sub": return a - b;
    case "mul": return a * b;
    case "div": return b !== 0 ? a / b : undefined;
    case "rem": return b !== 0 ? a % b : undefined;
    case "eq": return a === b;
    case "ne": return a !== b;
    case "lt": return a < b;
    case "le": return a <= b;
    case "gt": return a > b;
    case "ge": return a >= b;
    default: return undefined;
  }
}

function evalIntBinary(op: string, a: number, b: number): number | boolean | undefined {
  switch (op) {
    case "add": return a + b;
    case "sub": return a - b;
    case "mul": return a * b;
    case "div": return b !== 0 ? Math.trunc(a / b) : undefined;
    case "rem": return b !== 0 ? a % b : undefined;
    case "eq": return a === b;
    case "ne": return a !== b;
    case "lt": return a < b;
    case "le": return a <= b;
    case "gt": return a > b;
    case "ge": return a >= b;
    case "bit_and": return a & b;
    case "bit_or": return a | b;
    case "bit_xor": return a ^ b;
    case "shl": return a << b;
    case "shr": return a >> b;
    default: return undefined;
  }
}

function foldStmts(stmts: HIRStmt[]): void {
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case "expr":
        stmt.expr = foldExpr(stmt.expr);
        break;
      case "return":
        if (stmt.value) stmt.value = foldExpr(stmt.value);
        break;
      case "let":
        if (stmt.init) stmt.init = foldExpr(stmt.init);
        break;
      case "assign":
        stmt.value = foldExpr(stmt.value);
        break;
      case "if":
        stmt.condition = foldExpr(stmt.condition);
        foldStmts(stmt.then);
        if (stmt.else) foldStmts(stmt.else);
        break;
      case "while":
        stmt.condition = foldExpr(stmt.condition);
        foldStmts(stmt.body);
        break;
      case "for":
        if (stmt.init) foldStmts([stmt.init]);
        if (stmt.condition) stmt.condition = foldExpr(stmt.condition);
        if (stmt.update) stmt.update = foldExpr(stmt.update);
        foldStmts(stmt.body);
        break;
      case "switch":
        stmt.discriminant = foldExpr(stmt.discriminant);
        for (const c of stmt.cases) {
          if (c.test) c.test = foldExpr(c.test);
          foldStmts(c.body);
        }
        break;
      case "try":
        foldStmts(stmt.body);
        if (stmt.catch) foldStmts(stmt.catch.body);
        if (stmt.finally) foldStmts(stmt.finally);
        break;
      case "throw":
        stmt.value = foldExpr(stmt.value);
        break;
    }
  }
}

function foldFunction(fn: HIRFunction): void {
  foldStmts(fn.body);
}

export function constFoldPass(mod: HIRModule): void {
  for (const fn of mod.functions) foldFunction(fn);
  for (const cls of mod.classes) {
    for (const method of cls.methods) foldFunction(method);
  }
  foldStmts(mod.init);
  for (const g of mod.globals) {
    if (g.init) g.init = foldExpr(g.init);
  }
}
