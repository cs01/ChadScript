import type { HIRModule, HIRExpr, HIRStmt, HIRFunction, HIRType } from "../hir/types.js";

const I64: HIRType = { kind: "i64" };
const F64: HIRType = { kind: "f64" };

const ARITH_OPS = new Set(["add", "sub", "mul"]);
const CMP_OPS = new Set(["eq", "ne", "lt", "le", "gt", "ge"]);

function isPureExpr(expr: HIRExpr, fnName: string, paramIds: Set<number>, localIds: Set<number>): boolean {
  switch (expr.kind) {
    case "literal_i64":
    case "literal_i1":
      return true;
    case "literal_f64":
      return Number.isInteger(expr.value) && Math.abs(expr.value) <= Number.MAX_SAFE_INTEGER;
    case "local_get":
      return paramIds.has(expr.id) || localIds.has(expr.id);
    case "local_set":
      return localIds.has(expr.id) && isPureExpr(expr.value, fnName, paramIds, localIds);
    case "binary":
      if (!ARITH_OPS.has(expr.op) && !CMP_OPS.has(expr.op)) return false;
      return isPureExpr(expr.left, fnName, paramIds, localIds) &&
             isPureExpr(expr.right, fnName, paramIds, localIds);
    case "unary":
      if (expr.op !== "neg" && expr.op !== "not") return false;
      return isPureExpr(expr.operand, fnName, paramIds, localIds);
    case "conditional":
      return isPureExpr(expr.condition, fnName, paramIds, localIds) &&
             isPureExpr(expr.then, fnName, paramIds, localIds) &&
             isPureExpr(expr.else, fnName, paramIds, localIds);
    case "call":
      // Only allow self-recursion
      if (expr.callee !== fnName) return false;
      return expr.args.every((a) => isPureExpr(a, fnName, paramIds, localIds));
    case "widen_f64":
    case "narrow_i64":
      return isPureExpr(expr.value, fnName, paramIds, localIds);
    default:
      return false;
  }
}

function isPureStmt(stmt: HIRStmt, fnName: string, paramIds: Set<number>, localIds: Set<number>): boolean {
  switch (stmt.kind) {
    case "expr":
      return isPureExpr(stmt.expr, fnName, paramIds, localIds);
    case "let":
      localIds.add(stmt.id);
      if (stmt.type.kind !== "f64" && stmt.type.kind !== "i64" && stmt.type.kind !== "i1") return false;
      return stmt.init ? isPureExpr(stmt.init, fnName, paramIds, localIds) : true;
    case "return":
      return stmt.value ? isPureExpr(stmt.value, fnName, paramIds, localIds) : true;
    case "if":
      return isPureExpr(stmt.condition, fnName, paramIds, localIds) &&
             stmt.then.every((s) => isPureStmt(s, fnName, paramIds, localIds)) &&
             (stmt.else?.every((s) => isPureStmt(s, fnName, paramIds, localIds)) ?? true);
    case "while":
      return isPureExpr(stmt.condition, fnName, paramIds, localIds) &&
             stmt.body.every((s) => isPureStmt(s, fnName, paramIds, localIds));
    case "for":
      return (stmt.init ? isPureStmt(stmt.init, fnName, paramIds, localIds) : true) &&
             (stmt.condition ? isPureExpr(stmt.condition, fnName, paramIds, localIds) : true) &&
             (stmt.update ? isPureExpr(stmt.update, fnName, paramIds, localIds) : true) &&
             stmt.body.every((s) => isPureStmt(s, fnName, paramIds, localIds));
    case "break":
    case "continue":
      return true;
    default:
      return false;
  }
}

function rewriteExpr(expr: HIRExpr, fnName: string): HIRExpr {
  switch (expr.kind) {
    case "literal_f64":
      return { kind: "literal_i64", value: expr.value, type: I64 };
    case "local_get":
      if (expr.type.kind === "f64") return { ...expr, type: I64 };
      return expr;
    case "local_set":
      return { ...expr, value: rewriteExpr(expr.value, fnName), type: expr.type.kind === "f64" ? I64 : expr.type };
    case "binary": {
      const left = rewriteExpr(expr.left, fnName);
      const right = rewriteExpr(expr.right, fnName);
      const newType = CMP_OPS.has(expr.op) ? expr.type : (expr.type.kind === "f64" ? I64 : expr.type);
      return { ...expr, left, right, type: newType };
    }
    case "unary":
      return { ...expr, operand: rewriteExpr(expr.operand, fnName), type: expr.type.kind === "f64" ? I64 : expr.type };
    case "conditional":
      return {
        ...expr,
        condition: rewriteExpr(expr.condition, fnName),
        then: rewriteExpr(expr.then, fnName),
        else: rewriteExpr(expr.else, fnName),
        type: expr.type.kind === "f64" ? I64 : expr.type,
      };
    case "call":
      return { ...expr, args: expr.args.map((a) => rewriteExpr(a, fnName)), type: expr.type.kind === "f64" ? I64 : expr.type, returnType: expr.returnType.kind === "f64" ? I64 : expr.returnType };
    case "widen_f64":
      return rewriteExpr(expr.value, fnName);
    case "narrow_i64":
      return rewriteExpr(expr.value, fnName);
    default:
      return expr;
  }
}

function rewriteStmt(stmt: HIRStmt, fnName: string): HIRStmt {
  switch (stmt.kind) {
    case "expr":
      return { ...stmt, expr: rewriteExpr(stmt.expr, fnName) };
    case "let":
      return {
        ...stmt,
        type: stmt.type.kind === "f64" ? I64 : stmt.type,
        init: stmt.init ? rewriteExpr(stmt.init, fnName) : stmt.init,
      };
    case "return":
      return { ...stmt, value: stmt.value ? rewriteExpr(stmt.value, fnName) : stmt.value };
    case "if":
      return {
        ...stmt,
        condition: rewriteExpr(stmt.condition, fnName),
        then: stmt.then.map((s) => rewriteStmt(s, fnName)),
        else: stmt.else?.map((s) => rewriteStmt(s, fnName)),
      };
    case "while":
      return {
        ...stmt,
        condition: rewriteExpr(stmt.condition, fnName),
        body: stmt.body.map((s) => rewriteStmt(s, fnName)),
      };
    case "for":
      return {
        ...stmt,
        init: stmt.init ? rewriteStmt(stmt.init, fnName) : stmt.init,
        condition: stmt.condition ? rewriteExpr(stmt.condition, fnName) : stmt.condition,
        update: stmt.update ? rewriteExpr(stmt.update, fnName) : stmt.update,
        body: stmt.body.map((s) => rewriteStmt(s, fnName)),
      };
    default:
      return stmt;
  }
}

function tryNarrow(fn: HIRFunction): boolean {
  if (fn.params.length === 0) return false;
  if (fn.params.some((p) => p.type.kind !== "f64")) return false;
  if (fn.returnType.kind !== "f64" && fn.returnType.kind !== "void") return false;
  const paramIds = new Set<number>();
  for (const p of fn.params) paramIds.add(p.id);
  const localIds = new Set<number>();
  for (const s of fn.body) {
    if (!isPureStmt(s, fn.name, paramIds, localIds)) return false;
  }

  // Rewrite param types
  fn.params = fn.params.map((p) => ({ ...p, type: I64 }));
  // Rewrite return type
  if (fn.returnType.kind === "f64") fn.returnType = I64;
  // Rewrite body
  fn.body = fn.body.map((s) => rewriteStmt(s, fn.name));
  return true;
}

function rewriteCallSites(narrowed: Set<string>, expr: HIRExpr): HIRExpr {
  switch (expr.kind) {
    case "call": {
      const args = expr.args.map((a) => rewriteCallSites(narrowed, a));
      if (narrowed.has(expr.callee)) {
        // wrap each arg with narrow_i64 if it's f64; result needs widen_f64 if used as f64
        const narrowedArgs = args.map((a) =>
          a.type.kind === "f64" ? ({ kind: "narrow_i64", value: a, type: I64 } as HIRExpr) : a,
        );
        const newCall: HIRExpr = { ...expr, args: narrowedArgs, returnType: expr.returnType.kind === "f64" ? I64 : expr.returnType, type: expr.type.kind === "f64" ? I64 : expr.type };
        // If caller expected f64 (original type), widen back
        if (expr.type.kind === "f64") {
          return { kind: "widen_f64", value: newCall, type: F64 };
        }
        return newCall;
      }
      return { ...expr, args };
    }
    case "binary":
      return { ...expr, left: rewriteCallSites(narrowed, expr.left), right: rewriteCallSites(narrowed, expr.right) };
    case "unary":
      return { ...expr, operand: rewriteCallSites(narrowed, expr.operand) };
    case "conditional":
      return {
        ...expr,
        condition: rewriteCallSites(narrowed, expr.condition),
        then: rewriteCallSites(narrowed, expr.then),
        else: rewriteCallSites(narrowed, expr.else),
      };
    case "local_set":
      return { ...expr, value: rewriteCallSites(narrowed, expr.value) };
    case "global_set":
      return { ...expr, value: rewriteCallSites(narrowed, expr.value) };
    case "narrow_i64":
    case "widen_f64":
      return { ...expr, value: rewriteCallSites(narrowed, expr.value) };
    case "runtime_call":
      return { ...expr, args: expr.args.map((a) => rewriteCallSites(narrowed, a)) };
    case "vtable_call":
      return { ...expr, args: expr.args.map((a) => rewriteCallSites(narrowed, a)), object: rewriteCallSites(narrowed, expr.object) };
    case "call_closure":
      return { ...expr, callee: rewriteCallSites(narrowed, expr.callee), args: expr.args.map((a) => rewriteCallSites(narrowed, a)) };
    case "field_get":
      return { ...expr, object: rewriteCallSites(narrowed, expr.object) };
    case "field_set":
      return { ...expr, object: rewriteCallSites(narrowed, expr.object), value: rewriteCallSites(narrowed, expr.value) };
    case "index_get":
      return { ...expr, array: rewriteCallSites(narrowed, expr.array), index: rewriteCallSites(narrowed, expr.index) };
    case "index_set":
      return { ...expr, array: rewriteCallSites(narrowed, expr.array), index: rewriteCallSites(narrowed, expr.index), value: rewriteCallSites(narrowed, expr.value) };
    case "alloc_array":
      return { ...expr, initialValues: expr.initialValues.map((v) => rewriteCallSites(narrowed, v)) };
    case "alloc_struct":
      return { ...expr, fields: expr.fields.map((v) => rewriteCallSites(narrowed, v)) };
    case "alloc_dynobj":
      return {
        ...expr,
        props: (expr as any).props.map((p: any) => ({ ...p, value: rewriteCallSites(narrowed, p.value) })),
        spreadSource: (expr as any).spreadSource ? rewriteCallSites(narrowed, (expr as any).spreadSource) : (expr as any).spreadSource,
      };
    case "alloc_dynarray":
      return { ...expr, elements: (expr as any).elements.map((v: any) => rewriteCallSites(narrowed, v)) };
    case "alloc_array_spread":
      return { ...expr, elements: (expr as any).elements.map((e: any) => ({ ...e, value: rewriteCallSites(narrowed, e.value) })) };
    case "box":
      return { ...expr, value: rewriteCallSites(narrowed, expr.value) };
    case "unbox":
      return { ...expr, value: rewriteCallSites(narrowed, expr.value) };
    case "await":
      return { ...expr, value: rewriteCallSites(narrowed, expr.value) };
    case "wrap_interface":
      return { ...expr, value: rewriteCallSites(narrowed, expr.value) };
    case "nullish_coalesce":
      return { ...expr, left: rewriteCallSites(narrowed, expr.left), right: rewriteCallSites(narrowed, expr.right) };
    default:
      return expr;
  }
}

function rewriteCallSitesStmt(narrowed: Set<string>, stmt: HIRStmt): HIRStmt {
  switch (stmt.kind) {
    case "expr":
      return { ...stmt, expr: rewriteCallSites(narrowed, stmt.expr) };
    case "let":
      return { ...stmt, init: stmt.init ? rewriteCallSites(narrowed, stmt.init) : stmt.init };
    case "return":
      return { ...stmt, value: stmt.value ? rewriteCallSites(narrowed, stmt.value) : stmt.value };
    case "if":
      return {
        ...stmt,
        condition: rewriteCallSites(narrowed, stmt.condition),
        then: stmt.then.map((s) => rewriteCallSitesStmt(narrowed, s)),
        else: stmt.else?.map((s) => rewriteCallSitesStmt(narrowed, s)),
      };
    case "while":
      return {
        ...stmt,
        condition: rewriteCallSites(narrowed, stmt.condition),
        body: stmt.body.map((s) => rewriteCallSitesStmt(narrowed, s)),
      };
    case "for":
      return {
        ...stmt,
        init: stmt.init ? rewriteCallSitesStmt(narrowed, stmt.init) : stmt.init,
        condition: stmt.condition ? rewriteCallSites(narrowed, stmt.condition) : stmt.condition,
        update: stmt.update ? rewriteCallSites(narrowed, stmt.update) : stmt.update,
        body: stmt.body.map((s) => rewriteCallSitesStmt(narrowed, s)),
      };
    case "throw":
      return { ...stmt, value: rewriteCallSites(narrowed, stmt.value) };
    case "try":
      return {
        ...stmt,
        body: stmt.body.map((s) => rewriteCallSitesStmt(narrowed, s)),
        catch: stmt.catch ? { ...stmt.catch, body: stmt.catch.body.map((s) => rewriteCallSitesStmt(narrowed, s)) } : stmt.catch,
        finally: stmt.finally?.map((s) => rewriteCallSitesStmt(narrowed, s)),
      };
    case "switch":
      return {
        ...stmt,
        discriminant: rewriteCallSites(narrowed, stmt.discriminant),
        cases: stmt.cases.map((c) => ({ ...c, test: c.test ? rewriteCallSites(narrowed, c.test) : c.test, body: c.body.map((s) => rewriteCallSitesStmt(narrowed, s)) })),
      };
    default:
      return stmt;
  }
}

function collectClosureFnNames(expr: HIRExpr, out: Set<string>): void {
  switch (expr.kind) {
    case "make_closure":
      out.add(expr.funcName);
      break;
    case "binary":
      collectClosureFnNames(expr.left, out);
      collectClosureFnNames(expr.right, out);
      break;
    case "unary":
      collectClosureFnNames(expr.operand, out);
      break;
    case "conditional":
      collectClosureFnNames(expr.condition, out);
      collectClosureFnNames(expr.then, out);
      collectClosureFnNames(expr.else, out);
      break;
    case "call":
    case "runtime_call":
      for (const a of expr.args) collectClosureFnNames(a, out);
      break;
    case "vtable_call":
      collectClosureFnNames(expr.object, out);
      for (const a of expr.args) collectClosureFnNames(a, out);
      break;
    case "call_closure":
      collectClosureFnNames(expr.callee, out);
      for (const a of expr.args) collectClosureFnNames(a, out);
      break;
    case "field_get":
      collectClosureFnNames(expr.object, out);
      break;
    case "field_set":
      collectClosureFnNames(expr.object, out);
      collectClosureFnNames(expr.value, out);
      break;
    case "index_get":
      collectClosureFnNames(expr.array, out);
      collectClosureFnNames(expr.index, out);
      break;
    case "index_set":
      collectClosureFnNames(expr.array, out);
      collectClosureFnNames(expr.index, out);
      collectClosureFnNames(expr.value, out);
      break;
    case "local_set":
    case "global_set":
    case "narrow_i64":
    case "widen_f64":
    case "box":
    case "unbox":
    case "await":
    case "wrap_interface":
      collectClosureFnNames(expr.value, out);
      break;
    case "alloc_array":
      for (const v of expr.initialValues) collectClosureFnNames(v, out);
      break;
    case "alloc_struct":
      for (const v of expr.fields) collectClosureFnNames(v, out);
      break;
    case "nullish_coalesce":
      collectClosureFnNames(expr.left, out);
      collectClosureFnNames(expr.right, out);
      break;
    case "array_hof":
      collectClosureFnNames(expr.array, out);
      collectClosureFnNames(expr.callback, out);
      break;
  }
}

function collectClosureFnNamesStmt(stmt: HIRStmt, out: Set<string>): void {
  switch (stmt.kind) {
    case "expr":
      collectClosureFnNames(stmt.expr, out);
      break;
    case "let":
      if (stmt.init) collectClosureFnNames(stmt.init, out);
      break;
    case "return":
      if (stmt.value) collectClosureFnNames(stmt.value, out);
      break;
    case "if":
      collectClosureFnNames(stmt.condition, out);
      stmt.then.forEach((s) => collectClosureFnNamesStmt(s, out));
      stmt.else?.forEach((s) => collectClosureFnNamesStmt(s, out));
      break;
    case "while":
      collectClosureFnNames(stmt.condition, out);
      stmt.body.forEach((s) => collectClosureFnNamesStmt(s, out));
      break;
    case "for":
      if (stmt.init) collectClosureFnNamesStmt(stmt.init, out);
      if (stmt.condition) collectClosureFnNames(stmt.condition, out);
      if (stmt.update) collectClosureFnNames(stmt.update, out);
      stmt.body.forEach((s) => collectClosureFnNamesStmt(s, out));
      break;
    case "throw":
      collectClosureFnNames(stmt.value, out);
      break;
    case "try":
      stmt.body.forEach((s) => collectClosureFnNamesStmt(s, out));
      stmt.catch?.body.forEach((s) => collectClosureFnNamesStmt(s, out));
      stmt.finally?.forEach((s) => collectClosureFnNamesStmt(s, out));
      break;
    case "switch":
      collectClosureFnNames(stmt.discriminant, out);
      for (const c of stmt.cases) {
        if (c.test) collectClosureFnNames(c.test, out);
        c.body.forEach((s) => collectClosureFnNamesStmt(s, out));
      }
      break;
  }
}

export function narrowFnsPass(mod: HIRModule): void {
  const closureFns = new Set<string>();
  for (const fn of mod.functions) {
    fn.body.forEach((s) => collectClosureFnNamesStmt(s, closureFns));
  }
  for (const cls of mod.classes) {
    for (const m of cls.methods) m.body.forEach((s) => collectClosureFnNamesStmt(s, closureFns));
  }
  mod.init.forEach((s) => collectClosureFnNamesStmt(s, closureFns));

  const narrowed = new Set<string>();
  for (const fn of mod.functions) {
    if (closureFns.has(fn.name)) continue;
    if (tryNarrow(fn)) narrowed.add(fn.name);
  }
  if (narrowed.size === 0) return;
  for (const fn of mod.functions) {
    fn.body = fn.body.map((s) => rewriteCallSitesStmt(narrowed, s));
  }
  for (const cls of mod.classes) {
    for (const m of cls.methods) {
      m.body = m.body.map((s) => rewriteCallSitesStmt(narrowed, s));
    }
  }
  mod.init = mod.init.map((s) => rewriteCallSitesStmt(narrowed, s));
}
