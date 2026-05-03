import type { HIRModule, HIRExpr, HIRStmt, HIRFunction, HIRType } from "../hir/types.js";

const I8PTR: HIRType = { kind: "i8ptr" };

interface LocalInfo {
  id: number;
  appendSites: number;
  hasIncompatibleWrite: boolean;
  hasInit: boolean;
  initIsStringLiteral: boolean;
  declaredHere: boolean;
}

function leftmostLocalGet(value: HIRExpr): { kind: "local_get"; id: number; type: HIRType } | null {
  let cur: HIRExpr = value;
  while (cur.kind === "runtime_call" && cur.func === "cs_string_concat") {
    cur = cur.args[0];
  }
  if (cur.kind === "local_get") return cur as any;
  return null;
}

function isAppendOf(id: number, value: HIRExpr): boolean {
  if (value.kind !== "runtime_call") return false;
  if (value.func !== "cs_string_concat") return false;
  const lm = leftmostLocalGet(value);
  return lm !== null && lm.id === id;
}

function rewriteConcatChain(value: HIRExpr, id: number, eligible: Set<number>): HIRExpr {
  if (
    value.kind === "runtime_call" &&
    value.func === "cs_string_concat" &&
    leftmostLocalGet(value)?.id === id
  ) {
    const newLeft = rewriteConcatChain(value.args[0], id, eligible);
    return {
      kind: "runtime_call",
      func: "cs2_string_builder_append",
      args: [newLeft, rewriteExpr(value.args[1], eligible)],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  return rewriteExpr(value, eligible);
}

function visitExpr(expr: HIRExpr, info: Map<number, LocalInfo>, inLoop: boolean): void {
  switch (expr.kind) {
    case "local_set": {
      const cur = info.get(expr.id);
      if (cur) {
        if (isAppendOf(expr.id, expr.value)) {
          if (inLoop) cur.appendSites++;
          visitExpr((expr.value as HIRExpr & { kind: "runtime_call" }).args[1], info, inLoop);
        } else {
          cur.hasIncompatibleWrite = true;
          visitExpr(expr.value, info, inLoop);
        }
      } else {
        visitExpr(expr.value, info, inLoop);
      }
      return;
    }
    case "binary":
      visitExpr(expr.left, info, inLoop);
      visitExpr(expr.right, info, inLoop);
      return;
    case "unary":
      visitExpr(expr.operand, info, inLoop);
      return;
    case "call":
    case "runtime_call":
      for (const a of expr.args) visitExpr(a, info, inLoop);
      return;
    case "vtable_call":
      visitExpr(expr.object, info, inLoop);
      for (const a of expr.args) visitExpr(a, info, inLoop);
      return;
    case "call_closure":
      visitExpr(expr.callee, info, inLoop);
      for (const a of expr.args) visitExpr(a, info, inLoop);
      return;
    case "conditional":
      visitExpr(expr.condition, info, inLoop);
      visitExpr(expr.then, info, inLoop);
      visitExpr(expr.else, info, inLoop);
      return;
    case "field_get":
      visitExpr(expr.object, info, inLoop);
      return;
    case "field_set":
      visitExpr(expr.object, info, inLoop);
      visitExpr(expr.value, info, inLoop);
      return;
    case "index_get":
      visitExpr(expr.array, info, inLoop);
      visitExpr(expr.index, info, inLoop);
      return;
    case "index_set":
      visitExpr(expr.array, info, inLoop);
      visitExpr(expr.index, info, inLoop);
      visitExpr(expr.value, info, inLoop);
      return;
    case "global_set":
      visitExpr(expr.value, info, inLoop);
      return;
    case "narrow_i64":
    case "widen_f64":
    case "box":
    case "unbox":
    case "await":
    case "wrap_interface":
      visitExpr(expr.value, info, inLoop);
      return;
    case "alloc_array":
      for (const v of expr.initialValues) visitExpr(v, info, inLoop);
      return;
    case "alloc_struct":
      for (const v of expr.fields) visitExpr(v, info, inLoop);
      return;
    case "nullish_coalesce":
      visitExpr(expr.left, info, inLoop);
      visitExpr(expr.right, info, inLoop);
      return;
    case "array_hof":
      visitExpr(expr.array, info, inLoop);
      visitExpr(expr.callback, info, inLoop);
      return;
    default:
      return;
  }
}

function visitStmt(stmt: HIRStmt, info: Map<number, LocalInfo>, inLoop: boolean): void {
  switch (stmt.kind) {
    case "let":
      if (stmt.type.kind === "i8ptr" && stmt.mutable) {
        const init = stmt.init;
        const initIsStringLiteral = !!init && init.kind === "literal_string";
        info.set(stmt.id, {
          id: stmt.id,
          appendSites: 0,
          hasIncompatibleWrite: false,
          hasInit: !!init,
          initIsStringLiteral,
          declaredHere: true,
        });
        if (init && !initIsStringLiteral) {
          const cur = info.get(stmt.id)!;
          cur.hasIncompatibleWrite = true;
        }
        if (init) visitExpr(init, info, inLoop);
      } else if (stmt.init) {
        visitExpr(stmt.init, info, inLoop);
      }
      return;
    case "expr":
      visitExpr(stmt.expr, info, inLoop);
      return;
    case "return":
      if (stmt.value) visitExpr(stmt.value, info, inLoop);
      return;
    case "if":
      visitExpr(stmt.condition, info, inLoop);
      stmt.then.forEach((s) => visitStmt(s, info, inLoop));
      stmt.else?.forEach((s) => visitStmt(s, info, inLoop));
      return;
    case "while":
      visitExpr(stmt.condition, info, true);
      stmt.body.forEach((s) => visitStmt(s, info, true));
      return;
    case "for":
      if (stmt.init) visitStmt(stmt.init, info, inLoop);
      if (stmt.condition) visitExpr(stmt.condition, info, true);
      if (stmt.update) visitExpr(stmt.update, info, true);
      stmt.body.forEach((s) => visitStmt(s, info, true));
      return;
    case "throw":
      visitExpr(stmt.value, info, inLoop);
      return;
    case "try":
      stmt.body.forEach((s) => visitStmt(s, info, inLoop));
      stmt.catch?.body.forEach((s) => visitStmt(s, info, inLoop));
      stmt.finally?.forEach((s) => visitStmt(s, info, inLoop));
      return;
    case "switch":
      visitExpr(stmt.discriminant, info, inLoop);
      for (const c of stmt.cases) {
        if (c.test) visitExpr(c.test, info, inLoop);
        c.body.forEach((s) => visitStmt(s, info, inLoop));
      }
      return;
    default:
      return;
  }
}

function rewriteExpr(expr: HIRExpr, eligible: Set<number>): HIRExpr {
  switch (expr.kind) {
    case "local_set": {
      if (eligible.has(expr.id) && isAppendOf(expr.id, expr.value)) {
        return { ...expr, value: rewriteConcatChain(expr.value, expr.id, eligible) };
      }
      return { ...expr, value: rewriteExpr(expr.value, eligible) };
    }
    case "binary":
      return { ...expr, left: rewriteExpr(expr.left, eligible), right: rewriteExpr(expr.right, eligible) };
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
      if (eligible.has(stmt.id) && stmt.init && stmt.init.kind === "literal_string") {
        return {
          ...stmt,
          init: {
            kind: "runtime_call",
            func: "cs2_string_builder_init",
            args: [stmt.init],
            returnType: I8PTR,
            type: I8PTR,
          },
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
  const info = new Map<number, LocalInfo>();
  for (const s of body) visitStmt(s, info, false);
  const eligible = new Set<number>();
  for (const li of info.values()) {
    if (li.hasIncompatibleWrite) continue;
    if (!li.declaredHere) continue;
    if (!li.initIsStringLiteral) continue;
    if (li.appendSites < 1) continue;
    eligible.add(li.id);
  }
  if (eligible.size === 0) return body;
  return body.map((s) => rewriteStmt(s, eligible));
}

export function concatBuilderPass(mod: HIRModule): void {
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
