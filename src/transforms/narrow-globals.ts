import type { HIRModule, HIRExpr, HIRStmt, HIRFunction } from "../hir/types.js";
import { I64, F64 } from "../hir/types.js";

const SAFE_OPS = new Set(["add", "sub", "mul", "rem"]);
const CMP_OPS = new Set(["eq", "ne", "lt", "le", "gt", "ge"]);
const ARITH_OPS = new Set(["add", "sub", "mul", "rem"]);

interface GlobalState {
  name: string;
  hasIncompatibleWrite: boolean;
}

function isIntLiteralInit(e: HIRExpr | undefined): boolean {
  if (!e) return false;
  if (e.kind === "literal_i64") return true;
  if (e.kind === "literal_f64")
    return Number.isInteger(e.value) && Math.abs(e.value) <= Number.MAX_SAFE_INTEGER;
  if (e.kind === "widen_f64" && e.value.kind === "literal_i64") return true;
  return false;
}

function isSafeIntPureExpr(expr: HIRExpr, name: string, eligible: Set<string>): boolean {
  switch (expr.kind) {
    case "literal_i64":
      return true;
    case "literal_f64":
      return Number.isInteger(expr.value) && Math.abs(expr.value) <= Number.MAX_SAFE_INTEGER;
    case "global_get":
      if (expr.name === name) return true;
      if (eligible.has(expr.name)) return true;
      return expr.type.kind === "i64";
    case "local_get":
      return expr.type.kind === "i64";
    case "call":
    case "runtime_call":
      return expr.type.kind === "i64";
    case "binary":
      if (!SAFE_OPS.has(expr.op)) return false;
      return isSafeIntPureExpr(expr.left, name, eligible) && isSafeIntPureExpr(expr.right, name, eligible);
    case "widen_f64":
    case "narrow_i64":
      return isSafeIntPureExpr(expr.value, name, eligible);
    default:
      return false;
  }
}

function visitExpr(expr: HIRExpr, info: Map<string, GlobalState>, candidates: Set<string>): void {
  if (expr.kind === "global_set") {
    const cur = info.get(expr.name);
    if (cur && !isSafeIntPureExpr(expr.value, expr.name, candidates)) cur.hasIncompatibleWrite = true;
    visitExpr(expr.value, info, candidates);
    return;
  }
  switch (expr.kind) {
    case "binary":
      visitExpr(expr.left, info, candidates);
      visitExpr(expr.right, info, candidates);
      return;
    case "unary":
      visitExpr(expr.operand, info, candidates);
      return;
    case "call":
    case "runtime_call":
      for (const a of expr.args) visitExpr(a, info, candidates);
      return;
    case "vtable_call":
      visitExpr(expr.object, info, candidates);
      for (const a of expr.args) visitExpr(a, info, candidates);
      return;
    case "call_closure":
      visitExpr(expr.callee, info, candidates);
      for (const a of expr.args) visitExpr(a, info, candidates);
      return;
    case "conditional":
      visitExpr(expr.condition, info, candidates);
      visitExpr(expr.then, info, candidates);
      visitExpr(expr.else, info, candidates);
      return;
    case "field_get":
      visitExpr(expr.object, info, candidates);
      return;
    case "field_set":
      visitExpr(expr.object, info, candidates);
      visitExpr(expr.value, info, candidates);
      return;
    case "index_get":
      visitExpr(expr.array, info, candidates);
      visitExpr(expr.index, info, candidates);
      return;
    case "index_set":
      visitExpr(expr.array, info, candidates);
      visitExpr(expr.index, info, candidates);
      visitExpr(expr.value, info, candidates);
      return;
    case "local_set":
      visitExpr(expr.value, info, candidates);
      return;
    case "narrow_i64":
    case "widen_f64":
    case "box":
    case "unbox":
    case "await":
    case "wrap_interface":
      visitExpr(expr.value, info, candidates);
      return;
    case "alloc_array":
      for (const v of expr.initialValues) visitExpr(v, info, candidates);
      return;
    case "alloc_struct":
      for (const v of expr.fields) visitExpr(v, info, candidates);
      return;
    case "alloc_dynobj":
      for (const p of expr.props as any[]) visitExpr(p.value, info, candidates);
      if (expr.spreadSource) visitExpr(expr.spreadSource, info, candidates);
      return;
    case "alloc_dynarray":
      for (const v of expr.elements as any[]) visitExpr(v, info, candidates);
      return;
    case "alloc_array_spread":
      for (const e of expr.elements as any[]) visitExpr(e.value, info, candidates);
      return;
    case "alloc_map":
      for (const e of expr.entries as any[]) {
        visitExpr(e.key, info, candidates);
        visitExpr(e.value, info, candidates);
      }
      return;
    case "alloc_set":
      for (const v of expr.elements as any[]) visitExpr(v, info, candidates);
      return;
    case "nullish_coalesce":
      visitExpr(expr.left, info, candidates);
      visitExpr(expr.right, info, candidates);
      return;
    case "array_hof":
      visitExpr(expr.array, info, candidates);
      visitExpr(expr.callback, info, candidates);
      return;
    case "make_closure":
      return;
    default:
      return;
  }
}

function visitStmt(stmt: HIRStmt, info: Map<string, GlobalState>, candidates: Set<string>): void {
  switch (stmt.kind) {
    case "let":
      if (stmt.init) visitExpr(stmt.init, info, candidates);
      return;
    case "expr":
      visitExpr(stmt.expr, info, candidates);
      return;
    case "return":
      if (stmt.value) visitExpr(stmt.value, info, candidates);
      return;
    case "if":
      visitExpr(stmt.condition, info, candidates);
      stmt.then.forEach((s) => visitStmt(s, info, candidates));
      stmt.else?.forEach((s) => visitStmt(s, info, candidates));
      return;
    case "while":
      visitExpr(stmt.condition, info, candidates);
      stmt.body.forEach((s) => visitStmt(s, info, candidates));
      return;
    case "for":
      if (stmt.init) visitStmt(stmt.init, info, candidates);
      if (stmt.condition) visitExpr(stmt.condition, info, candidates);
      if (stmt.update) visitExpr(stmt.update, info, candidates);
      stmt.body.forEach((s) => visitStmt(s, info, candidates));
      return;
    case "throw":
      visitExpr(stmt.value, info, candidates);
      return;
    case "try":
      stmt.body.forEach((s) => visitStmt(s, info, candidates));
      stmt.catch?.body.forEach((s) => visitStmt(s, info, candidates));
      stmt.finally?.forEach((s) => visitStmt(s, info, candidates));
      return;
    case "switch":
      visitExpr(stmt.discriminant, info, candidates);
      for (const c of stmt.cases) {
        if (c.test) visitExpr(c.test, info, candidates);
        c.body.forEach((s) => visitStmt(s, info, candidates));
      }
      return;
    default:
      return;
  }
}

function rewriteValueAsI64(expr: HIRExpr, eligible: Set<string>): HIRExpr {
  switch (expr.kind) {
    case "literal_f64":
      return { kind: "literal_i64", value: expr.value, type: I64 };
    case "literal_i64":
      return expr;
    case "global_get":
      if (eligible.has(expr.name)) return { ...expr, type: I64 };
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
    default: {
      const r = rewriteExpr(expr, eligible);
      if (r.kind === "widen_f64" && r.value.type.kind === "i64") return r.value;
      return r;
    }
  }
}

function tryStripToI64(expr: HIRExpr, eligible: Set<string>): HIRExpr | null {
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
      if (v.kind === "global_get") {
        if (eligible.has(v.name)) return { ...v, type: I64 };
        if (v.type.kind === "i64") return v;
      }
      if (v.kind === "local_get" && v.type.kind === "i64") return v;
      if (v.kind === "literal_i64") return v;
      if (v.type.kind === "i64") return v;
      return null;
    }
    case "global_get":
      if (eligible.has(expr.name)) return { ...expr, type: I64 };
      if (expr.type.kind === "i64") return expr;
      return null;
    case "binary":
      if (expr.type.kind === "i64") return expr;
      return null;
    default:
      return null;
  }
}

const STMT_LIKE_KINDS = new Set(["global_set", "local_set", "field_set", "index_set"]);

function rewriteExpr(expr: HIRExpr, eligible: Set<string>): HIRExpr {
  const origTypeKind = expr.type.kind;
  const out = rewriteExprInner(expr, eligible);
  if (origTypeKind === "f64" && out.type.kind === "i64" && !STMT_LIKE_KINDS.has(out.kind)) {
    return { kind: "widen_f64", value: out, type: F64 };
  }
  return out;
}

function rewriteExprInner(expr: HIRExpr, eligible: Set<string>): HIRExpr {
  switch (expr.kind) {
    case "global_get":
      if (eligible.has(expr.name)) {
        return { kind: "widen_f64", value: { ...expr, type: I64 }, type: F64 };
      }
      return expr;
    case "global_set": {
      if (eligible.has(expr.name)) {
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
    case "local_set":
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

function rewriteStmt(stmt: HIRStmt, eligible: Set<string>): HIRStmt {
  switch (stmt.kind) {
    case "let":
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

function visitFn(fn: HIRFunction, info: Map<string, GlobalState>, candidates: Set<string>): void {
  for (const s of fn.body) visitStmt(s, info, candidates);
}

function rewriteFn(fn: HIRFunction, eligible: Set<string>): void {
  fn.body = fn.body.map((s) => rewriteStmt(s, eligible));
}

export function narrowGlobalsPass(mod: HIRModule): void {
  const info = new Map<string, GlobalState>();
  for (const g of mod.globals) {
    if (g.type.kind !== "f64") continue;
    info.set(g.name, { name: g.name, hasIncompatibleWrite: false });
  }
  if (info.size === 0) return;

  const candidates = new Set<string>();
  for (const [k, _ig] of info) candidates.add(k);
  for (const s of mod.init) visitStmt(s, info, candidates);
  for (const fn of mod.functions) visitFn(fn, info, candidates);
  for (const cls of mod.classes) for (const m of cls.methods) visitFn(m, info, candidates);

  const eligible = new Set<string>();
  for (const [_gk, gi] of info) {
    if (!gi.hasIncompatibleWrite) eligible.add(gi.name);
  }
  if (eligible.size === 0) return;

  for (const g of mod.globals) {
    if (eligible.has(g.name)) {
      g.type = I64;
      if (g.init) g.init = rewriteValueAsI64(g.init, eligible);
    }
  }
  mod.init = mod.init.map((s) => rewriteStmt(s, eligible));
  for (const fn of mod.functions) rewriteFn(fn, eligible);
  for (const cls of mod.classes) for (const m of cls.methods) rewriteFn(m, eligible);
}
