import type { HIRModule, HIRExpr, HIRStmt, HIRFunction } from "../hir/types.js";

const ARITH_OPS = new Set(["add", "sub", "mul"]);
const I64: HIRExpr["type"] = { kind: "i64" };
const F64: HIRExpr["type"] = { kind: "f64" };

function rewrite(expr: HIRExpr): HIRExpr {
  switch (expr.kind) {
    case "binary": {
      const left = rewrite(expr.left);
      const right = rewrite(expr.right);
      // Pattern: f64 add/sub/mul of two widened i64s -> int op then widen.
      if (
        expr.type.kind === "f64" &&
        ARITH_OPS.has(expr.op) &&
        ((left.kind === "widen_f64" && rightIsIntLike(right)) ||
          (right.kind === "widen_f64" && leftIsIntLike(left)) ||
          (left.kind === "widen_f64" && right.kind === "widen_f64"))
      ) {
        const lInt = unwrap(left);
        const rInt = unwrap(right);
        if (lInt && rInt) {
          const intBinary: HIRExpr = {
            kind: "binary",
            op: expr.op,
            left: lInt,
            right: rInt,
            type: I64,
          };
          return { kind: "widen_f64", value: intBinary, type: F64 };
        }
      }
      return { ...expr, left, right };
    }
    case "narrow_i64": {
      const inner = rewrite(expr.value);
      if (inner.kind === "widen_f64") return inner.value;
      return { ...expr, value: inner };
    }
    case "widen_f64": {
      const inner = rewrite(expr.value);
      if (inner.kind === "narrow_i64") return inner.value;
      return { ...expr, value: inner };
    }
    case "unary":
      return { ...expr, operand: rewrite(expr.operand) };
    case "call":
      return { ...expr, args: expr.args.map(rewrite) };
    case "runtime_call":
      return { ...expr, args: expr.args.map(rewrite) };
    case "vtable_call":
      return { ...expr, args: expr.args.map(rewrite), object: rewrite(expr.object) };
    case "call_closure":
      return { ...expr, callee: rewrite(expr.callee), args: expr.args.map(rewrite) };
    case "field_get":
      return { ...expr, object: rewrite(expr.object) };
    case "field_set":
      return { ...expr, object: rewrite(expr.object), value: rewrite(expr.value) };
    case "index_get":
      return { ...expr, array: rewrite(expr.array), index: rewrite(expr.index) };
    case "index_set":
      return { ...expr, array: rewrite(expr.array), index: rewrite(expr.index), value: rewrite(expr.value) };
    case "conditional":
      return { ...expr, condition: rewrite(expr.condition), then: rewrite(expr.then), else: rewrite(expr.else) };
    case "local_set":
      return { ...expr, value: rewrite(expr.value) };
    case "global_set":
      return { ...expr, value: rewrite(expr.value) };
    case "alloc_array":
      return { ...expr, initialValues: expr.initialValues.map(rewrite) };
    case "alloc_struct":
      return { ...expr, fields: expr.fields.map(rewrite) };
    case "alloc_dynobj":
      return {
        ...expr,
        props: (expr as any).props.map((p: any) => ({ ...p, value: rewrite(p.value) })),
        spreadSource: (expr as any).spreadSource ? rewrite((expr as any).spreadSource) : (expr as any).spreadSource,
      };
    case "alloc_dynarray":
      return { ...expr, elements: (expr as any).elements.map(rewrite) };
    case "alloc_array_spread":
      return { ...expr, elements: (expr as any).elements.map((e: any) => ({ ...e, value: rewrite(e.value) })) };
    case "box":
      return { ...expr, value: rewrite(expr.value) };
    case "unbox":
      return { ...expr, value: rewrite(expr.value) };
    case "await":
      return { ...expr, value: rewrite(expr.value) };
    case "wrap_interface":
      return { ...expr, value: rewrite(expr.value) };
    case "make_closure":
      return expr;
    case "nullish_coalesce":
      return { ...expr, left: rewrite(expr.left), right: rewrite(expr.right) };
    default:
      return expr;
  }
}

function unwrap(e: HIRExpr): HIRExpr | null {
  if (e.kind === "widen_f64") return e.value;
  if (e.kind === "literal_f64" && Number.isInteger(e.value)) {
    return { kind: "literal_i64", value: e.value, type: I64 };
  }
  return null;
}

function rightIsIntLike(e: HIRExpr): boolean {
  return e.kind === "widen_f64" || (e.kind === "literal_f64" && Number.isInteger(e.value));
}

function leftIsIntLike(e: HIRExpr): boolean {
  return rightIsIntLike(e);
}

function rewriteStmt(stmt: HIRStmt): HIRStmt {
  switch (stmt.kind) {
    case "expr":
      return { ...stmt, expr: rewrite(stmt.expr) };
    case "let":
      return { ...stmt, init: stmt.init ? rewrite(stmt.init) : stmt.init };
    case "return":
      return { ...stmt, value: stmt.value ? rewrite(stmt.value) : stmt.value };
    case "if":
      return {
        ...stmt,
        condition: rewrite(stmt.condition),
        then: stmt.then.map(rewriteStmt),
        else: stmt.else?.map(rewriteStmt),
      };
    case "while":
      return { ...stmt, condition: rewrite(stmt.condition), body: stmt.body.map(rewriteStmt) };
    case "for":
      return {
        ...stmt,
        init: stmt.init ? rewriteStmt(stmt.init) : stmt.init,
        condition: stmt.condition ? rewrite(stmt.condition) : stmt.condition,
        update: stmt.update ? rewrite(stmt.update) : stmt.update,
        body: stmt.body.map(rewriteStmt),
      };
    case "throw":
      return { ...stmt, value: rewrite(stmt.value) };
    case "try":
      return {
        ...stmt,
        body: stmt.body.map(rewriteStmt),
        catch: stmt.catch
          ? { ...stmt.catch, body: stmt.catch.body.map(rewriteStmt) }
          : stmt.catch,
        finally: stmt.finally?.map(rewriteStmt),
      };
    case "switch":
      return {
        ...stmt,
        discriminant: rewrite(stmt.discriminant),
        cases: stmt.cases.map((c) => ({
          ...c,
          test: c.test ? rewrite(c.test) : c.test,
          body: c.body.map(rewriteStmt),
        })),
      };
    default:
      return stmt;
  }
}

function rewriteFunction(fn: HIRFunction): void {
  fn.body = fn.body.map(rewriteStmt);
}

export function narrowFpPass(mod: HIRModule): void {
  for (const fn of mod.functions) rewriteFunction(fn);
  for (const cls of mod.classes) {
    for (const method of cls.methods) rewriteFunction(method);
  }
  mod.init = mod.init.map(rewriteStmt);
}
