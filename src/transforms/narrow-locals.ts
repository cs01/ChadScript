import type { HIRModule, HIRExpr, HIRStmt, HIRFunction, HIRType } from "../hir/types.js";

const I64: HIRType = { kind: "i64" };
const F64: HIRType = { kind: "f64" };
const SAFE_OPS = new Set(["add", "sub"]);

interface LocalState {
  id: number;
  initIsIntLiteral: boolean;
  hasIncompatibleWrite: boolean;
}

function isSafeIntPureExpr(expr: HIRExpr, id: number): boolean {
  switch (expr.kind) {
    case "literal_i64":
      return true;
    case "literal_f64":
      return Number.isInteger(expr.value) && Math.abs(expr.value) <= Number.MAX_SAFE_INTEGER;
    case "local_get":
      return expr.id === id;
    case "binary":
      if (!SAFE_OPS.has(expr.op)) return false;
      return isSafeIntPureExpr(expr.left, id) && isSafeIntPureExpr(expr.right, id);
    case "widen_f64":
    case "narrow_i64":
      return isSafeIntPureExpr(expr.value, id);
    default:
      return false;
  }
}

function visitExpr(expr: HIRExpr, info: Map<number, LocalState>): void {
  if (expr.kind === "local_set") {
    const cur = info.get(expr.id);
    if (cur) {
      if (!isSafeIntPureExpr(expr.value, expr.id)) cur.hasIncompatibleWrite = true;
    }
    visitExpr(expr.value, info);
    return;
  }
  if (expr.kind === "make_closure") {
    for (const c of expr.captures) {
      const cur = info.get(c.id);
      if (cur) cur.hasIncompatibleWrite = true;
    }
    return;
  }
  switch (expr.kind) {
    case "binary":
      visitExpr(expr.left, info);
      visitExpr(expr.right, info);
      return;
    case "unary":
      visitExpr(expr.operand, info);
      return;
    case "call":
    case "runtime_call":
      for (const a of expr.args) visitExpr(a, info);
      return;
    case "vtable_call":
      visitExpr(expr.object, info);
      for (const a of expr.args) visitExpr(a, info);
      return;
    case "call_closure":
      visitExpr(expr.callee, info);
      for (const a of expr.args) visitExpr(a, info);
      return;
    case "conditional":
      visitExpr(expr.condition, info);
      visitExpr(expr.then, info);
      visitExpr(expr.else, info);
      return;
    case "field_get":
      visitExpr(expr.object, info);
      return;
    case "field_set":
      visitExpr(expr.object, info);
      visitExpr(expr.value, info);
      return;
    case "index_get":
      visitExpr(expr.array, info);
      visitExpr(expr.index, info);
      return;
    case "index_set":
      visitExpr(expr.array, info);
      visitExpr(expr.index, info);
      visitExpr(expr.value, info);
      return;
    case "global_set":
      visitExpr(expr.value, info);
      return;
    case "narrow_i64":
    case "widen_f64":
    case "box":
    case "unbox":
    case "await":
    case "wrap_interface":
      visitExpr(expr.value, info);
      return;
    case "alloc_array":
      for (const v of expr.initialValues) visitExpr(v, info);
      return;
    case "alloc_struct":
      for (const v of expr.fields) visitExpr(v, info);
      return;
    case "nullish_coalesce":
      visitExpr(expr.left, info);
      visitExpr(expr.right, info);
      return;
    case "array_hof":
      visitExpr(expr.array, info);
      visitExpr(expr.callback, info);
      return;
    default:
      return;
  }
}

function visitStmt(stmt: HIRStmt, info: Map<number, LocalState>): void {
  switch (stmt.kind) {
    case "let": {
      if (stmt.type.kind === "f64" && stmt.mutable) {
        const init = stmt.init;
        const initIsIntLiteral =
          !!init &&
          ((init.kind === "literal_f64" && Number.isInteger(init.value) && Math.abs(init.value) <= Number.MAX_SAFE_INTEGER) ||
            (init.kind === "widen_f64" && init.value.kind === "literal_i64") ||
            init.kind === "literal_i64");
        info.set(stmt.id, {
          id: stmt.id,
          initIsIntLiteral,
          hasIncompatibleWrite: !initIsIntLiteral,
        });
      }
      if (stmt.init) visitExpr(stmt.init, info);
      return;
    }
    case "expr":
      visitExpr(stmt.expr, info);
      return;
    case "return":
      if (stmt.value) visitExpr(stmt.value, info);
      return;
    case "if":
      visitExpr(stmt.condition, info);
      stmt.then.forEach((s) => visitStmt(s, info));
      stmt.else?.forEach((s) => visitStmt(s, info));
      return;
    case "while":
      visitExpr(stmt.condition, info);
      stmt.body.forEach((s) => visitStmt(s, info));
      return;
    case "for":
      if (stmt.init) visitStmt(stmt.init, info);
      if (stmt.condition) visitExpr(stmt.condition, info);
      if (stmt.update) visitExpr(stmt.update, info);
      stmt.body.forEach((s) => visitStmt(s, info));
      return;
    case "throw":
      visitExpr(stmt.value, info);
      return;
    case "try":
      stmt.body.forEach((s) => visitStmt(s, info));
      stmt.catch?.body.forEach((s) => visitStmt(s, info));
      stmt.finally?.forEach((s) => visitStmt(s, info));
      return;
    case "switch":
      visitExpr(stmt.discriminant, info);
      for (const c of stmt.cases) {
        if (c.test) visitExpr(c.test, info);
        c.body.forEach((s) => visitStmt(s, info));
      }
      return;
    default:
      return;
  }
}

function rewriteValueAsI64(expr: HIRExpr, eligible: Set<number>): HIRExpr {
  switch (expr.kind) {
    case "literal_f64":
      return { kind: "literal_i64", value: expr.value, type: I64 };
    case "literal_i64":
      return expr;
    case "local_get":
      if (eligible.has(expr.id)) return { ...expr, type: I64 };
      return expr;
    case "binary":
      if (SAFE_OPS.has(expr.op)) {
        return {
          ...expr,
          left: rewriteValueAsI64(expr.left, eligible),
          right: rewriteValueAsI64(expr.right, eligible),
          type: I64,
        };
      }
      return expr;
    case "widen_f64":
      return rewriteValueAsI64(expr.value, eligible);
    case "narrow_i64":
      return rewriteValueAsI64(expr.value, eligible);
    default:
      return expr;
  }
}

function tryStripToI64(expr: HIRExpr, eligible: Set<number>): HIRExpr | null {
  switch (expr.kind) {
    case "literal_i64":
      return expr;
    case "literal_f64":
      if (Number.isInteger(expr.value) && Math.abs(expr.value) <= Number.MAX_SAFE_INTEGER) {
        return { kind: "literal_i64", value: expr.value, type: I64 };
      }
      return null;
    case "widen_f64": {
      const v = expr.value;
      if (v.kind === "local_get") {
        if (eligible.has(v.id)) return { ...v, type: I64 };
        if (v.type.kind === "i64") return v;
      }
      if (v.kind === "global_get" && v.type.kind === "i64") return v;
      if (v.kind === "literal_i64") return v;
      if (v.type.kind === "i64") return v;
      return null;
    }
    case "local_get":
      if (eligible.has(expr.id)) return { ...expr, type: I64 };
      if (expr.type.kind === "i64") return expr;
      return null;
    case "binary":
      if (expr.type.kind === "i64") return expr;
      return null;
    default:
      return null;
  }
}

const CMP_OPS = new Set(["eq", "ne", "lt", "le", "gt", "ge"]);
const ARITH_OPS = new Set(["add", "sub", "mul", "rem"]);

function rewriteExpr(expr: HIRExpr, eligible: Set<number>): HIRExpr {
  const origTypeKind = expr.type.kind;
  const out = rewriteExprInner(expr, eligible);
  if (origTypeKind === "f64" && out.type.kind === "i64") {
    return { kind: "widen_f64", value: out, type: F64 };
  }
  return out;
}

function rewriteExprInner(expr: HIRExpr, eligible: Set<number>): HIRExpr {
  switch (expr.kind) {
    case "local_get":
      if (eligible.has(expr.id)) {
        return { kind: "widen_f64", value: { ...expr, type: I64 }, type: F64 };
      }
      return expr;
    case "local_set": {
      if (eligible.has(expr.id)) {
        const newVal = rewriteValueAsI64(expr.value, eligible);
        return { ...expr, value: newVal, type: I64 };
      }
      return { ...expr, value: rewriteExpr(expr.value, eligible) };
    }
    case "binary": {
      const left = rewriteExpr(expr.left, eligible);
      const right = rewriteExpr(expr.right, eligible);
      if (CMP_OPS.has(expr.op) || ARITH_OPS.has(expr.op)) {
        const lI64 = tryStripToI64(left, eligible);
        const rI64 = tryStripToI64(right, eligible);
        if (lI64 && rI64) {
          const t = CMP_OPS.has(expr.op) ? expr.type : I64;
          return { ...expr, left: lI64, right: rI64, type: t };
        }
      }
      return { ...expr, left, right };
    }
    case "unary":
      return { ...expr, operand: rewriteExpr(expr.operand, eligible) };
    case "call":
    case "runtime_call":
      return { ...expr, args: expr.args.map((a) => rewriteExpr(a, eligible)) };
    case "vtable_call":
      return { ...expr, object: rewriteExpr(expr.object, eligible), args: expr.args.map((a) => rewriteExpr(a, eligible)) };
    case "call_closure":
      return { ...expr, callee: rewriteExpr(expr.callee, eligible), args: expr.args.map((a) => rewriteExpr(a, eligible)) };
    case "conditional":
      return {
        ...expr,
        condition: rewriteExpr(expr.condition, eligible),
        then: rewriteExpr(expr.then, eligible),
        else: rewriteExpr(expr.else, eligible),
      };
    case "field_get":
      return { ...expr, object: rewriteExpr(expr.object, eligible) };
    case "field_set":
      return { ...expr, object: rewriteExpr(expr.object, eligible), value: rewriteExpr(expr.value, eligible) };
    case "index_get":
      return { ...expr, array: rewriteExpr(expr.array, eligible), index: rewriteExpr(expr.index, eligible) };
    case "index_set":
      return { ...expr, array: rewriteExpr(expr.array, eligible), index: rewriteExpr(expr.index, eligible), value: rewriteExpr(expr.value, eligible) };
    case "global_set":
      return { ...expr, value: rewriteExpr(expr.value, eligible) };
    case "narrow_i64":
    case "widen_f64":
    case "box":
    case "unbox":
    case "await":
    case "wrap_interface":
      return { ...expr, value: rewriteExpr(expr.value, eligible) };
    case "alloc_array":
      return { ...expr, initialValues: expr.initialValues.map((v) => rewriteExpr(v, eligible)) };
    case "alloc_struct":
      return { ...expr, fields: expr.fields.map((v) => rewriteExpr(v, eligible)) };
    case "alloc_dynobj":
      return {
        ...expr,
        props: expr.props.map((p: any) => ({ ...p, value: rewriteExpr(p.value, eligible) })),
        spreadSource: expr.spreadSource ? rewriteExpr(expr.spreadSource, eligible) : expr.spreadSource,
      };
    case "alloc_dynarray":
      return { ...expr, elements: expr.elements.map((v: any) => rewriteExpr(v, eligible)) };
    case "alloc_array_spread":
      return { ...expr, elements: expr.elements.map((e: any) => ({ ...e, value: rewriteExpr(e.value, eligible) })) };
    case "alloc_map":
      return { ...expr, entries: expr.entries.map((e: any) => ({ key: rewriteExpr(e.key, eligible), value: rewriteExpr(e.value, eligible) })) };
    case "alloc_set":
      return { ...expr, elements: expr.elements.map((v: any) => rewriteExpr(v, eligible)) };
    case "nullish_coalesce":
      return { ...expr, left: rewriteExpr(expr.left, eligible), right: rewriteExpr(expr.right, eligible) };
    case "array_hof":
      return { ...expr, array: rewriteExpr(expr.array, eligible), callback: rewriteExpr(expr.callback, eligible) };
    default:
      return expr;
  }
}

function rewriteStmt(stmt: HIRStmt, eligible: Set<number>): HIRStmt {
  switch (stmt.kind) {
    case "let":
      if (eligible.has(stmt.id) && stmt.init) {
        return {
          ...stmt,
          type: I64,
          init: rewriteValueAsI64(stmt.init, eligible),
        };
      }
      return { ...stmt, init: stmt.init ? rewriteExpr(stmt.init, eligible) : stmt.init };
    case "expr":
      return { ...stmt, expr: rewriteExpr(stmt.expr, eligible) };
    case "return":
      return { ...stmt, value: stmt.value ? rewriteExpr(stmt.value, eligible) : stmt.value };
    case "if":
      return {
        ...stmt,
        condition: rewriteExpr(stmt.condition, eligible),
        then: stmt.then.map((s) => rewriteStmt(s, eligible)),
        else: stmt.else?.map((s) => rewriteStmt(s, eligible)),
      };
    case "while":
      return {
        ...stmt,
        condition: rewriteExpr(stmt.condition, eligible),
        body: stmt.body.map((s) => rewriteStmt(s, eligible)),
      };
    case "for":
      return {
        ...stmt,
        init: stmt.init ? rewriteStmt(stmt.init, eligible) : stmt.init,
        condition: stmt.condition ? rewriteExpr(stmt.condition, eligible) : stmt.condition,
        update: stmt.update ? rewriteExpr(stmt.update, eligible) : stmt.update,
        body: stmt.body.map((s) => rewriteStmt(s, eligible)),
      };
    case "throw":
      return { ...stmt, value: rewriteExpr(stmt.value, eligible) };
    case "try":
      return {
        ...stmt,
        body: stmt.body.map((s) => rewriteStmt(s, eligible)),
        catch: stmt.catch ? { ...stmt.catch, body: stmt.catch.body.map((s) => rewriteStmt(s, eligible)) } : stmt.catch,
        finally: stmt.finally?.map((s) => rewriteStmt(s, eligible)),
      };
    case "switch":
      return {
        ...stmt,
        discriminant: rewriteExpr(stmt.discriminant, eligible),
        cases: stmt.cases.map((c) => ({
          ...c,
          test: c.test ? rewriteExpr(c.test, eligible) : c.test,
          body: c.body.map((s) => rewriteStmt(s, eligible)),
        })),
      };
    default:
      return stmt;
  }
}

function processBody(body: HIRStmt[]): HIRStmt[] {
  const info = new Map<number, LocalState>();
  for (const s of body) visitStmt(s, info);
  const eligible = new Set<number>();
  for (const [_lk, li] of info) {
    if (li.hasIncompatibleWrite) continue;
    if (!li.initIsIntLiteral) continue;
    eligible.add(li.id);
  }
  if (eligible.size === 0) return body;
  return body.map((s) => rewriteStmt(s, eligible));
}

export function narrowLocalsPass(mod: HIRModule): void {
  for (const fn of mod.functions) {
    fn.body = processBody(fn.body);
  }
  for (const cls of mod.classes) {
    for (const m of cls.methods) {
      m.body = processBody(m.body);
    }
  }
  mod.init = processBody(mod.init);
}
