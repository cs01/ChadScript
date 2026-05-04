import type { HIRModule, HIRExpr, HIRStmt, HIRType } from "../hir/types.js";

const I8PTR: HIRType = { kind: "i8ptr" };

interface LocalInfo {
  id: number;
  appendSites: number;
  hasIncompatibleWrite: boolean;
  hasInit: boolean;
  initIsStringLiteral: boolean;
  declaredHere: boolean;
}

interface GlobalInfo {
  name: string;
  appendSites: number;
  hasIncompatibleWrite: boolean;
  initSites?: number;
}

interface Eligibility {
  locals: Set<number>;
  globals: Set<string>;
}

function leftmostLocalGet(value: HIRExpr): { kind: "local_get"; id: number; type: HIRType } | null {
  let cur: HIRExpr = value;
  while (cur.kind === "runtime_call" && cur.func === "cs_string_concat") {
    cur = cur.args[0];
  }
  if (cur.kind === "local_get") return cur as any;
  return null;
}

function leftmostGlobalGet(value: HIRExpr): { kind: "global_get"; name: string; type: HIRType } | null {
  let cur: HIRExpr = value;
  while (cur.kind === "runtime_call" && cur.func === "cs_string_concat") {
    cur = cur.args[0];
  }
  if (cur.kind === "global_get") return cur as any;
  return null;
}

function isAppendOf(id: number, value: HIRExpr): boolean {
  if (value.kind !== "runtime_call") return false;
  if (value.func !== "cs_string_concat") return false;
  const lm = leftmostLocalGet(value);
  return lm !== null && lm.id === id;
}

function isAppendOfGlobal(name: string, value: HIRExpr): boolean {
  if (value.kind !== "runtime_call") return false;
  if (value.func !== "cs_string_concat") return false;
  const lm = leftmostGlobalGet(value);
  return lm !== null && lm.name === name;
}

function rewriteConcatChainLocal(value: HIRExpr, id: number, el: Eligibility): HIRExpr {
  if (
    value.kind === "runtime_call" &&
    value.func === "cs_string_concat" &&
    leftmostLocalGet(value)?.id === id
  ) {
    const newLeft = rewriteConcatChainLocal(value.args[0], id, el);
    return {
      kind: "runtime_call",
      func: "cs2_string_builder_append",
      args: [newLeft, rewriteExpr(value.args[1], el)],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  return rewriteExpr(value, el);
}

function rewriteConcatChainGlobal(value: HIRExpr, name: string, el: Eligibility): HIRExpr {
  if (
    value.kind === "runtime_call" &&
    value.func === "cs_string_concat" &&
    leftmostGlobalGet(value)?.name === name
  ) {
    const newLeft = rewriteConcatChainGlobal(value.args[0], name, el);
    return {
      kind: "runtime_call",
      func: "cs2_string_builder_append",
      args: [newLeft, rewriteExpr(value.args[1], el)],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  return rewriteExpr(value, el);
}

function visitExpr(
  expr: HIRExpr,
  info: Map<number, LocalInfo>,
  gInfo: Map<string, GlobalInfo>,
  inLoop: boolean,
): void {
  switch (expr.kind) {
    case "local_set": {
      const cur = info.get(expr.id);
      if (cur) {
        if (isAppendOf(expr.id, expr.value)) {
          if (inLoop) cur.appendSites = cur.appendSites + 1;
          visitExpr((expr.value as HIRExpr & { kind: "runtime_call" }).args[1], info, gInfo, inLoop);
        } else {
          cur.hasIncompatibleWrite = true;
          visitExpr(expr.value, info, gInfo, inLoop);
        }
      } else {
        visitExpr(expr.value, info, gInfo, inLoop);
      }
      return;
    }
    case "global_set": {
      const cur = gInfo.get(expr.name);
      if (cur) {
        if (isAppendOfGlobal(expr.name, expr.value)) {
          if (inLoop) cur.appendSites = cur.appendSites + 1;
          visitExpr((expr.value as HIRExpr & { kind: "runtime_call" }).args[1], info, gInfo, inLoop);
        } else if (expr.value.kind === "literal_string") {
          cur.initSites = (cur.initSites ?? 0) + 1;
        } else {
          cur.hasIncompatibleWrite = true;
          visitExpr(expr.value, info, gInfo, inLoop);
        }
      } else {
        visitExpr(expr.value, info, gInfo, inLoop);
      }
      return;
    }
    case "binary":
      visitExpr(expr.left, info, gInfo, inLoop);
      visitExpr(expr.right, info, gInfo, inLoop);
      return;
    case "unary":
      visitExpr(expr.operand, info, gInfo, inLoop);
      return;
    case "call":
    case "runtime_call":
      for (const a of expr.args) visitExpr(a, info, gInfo, inLoop);
      return;
    case "vtable_call":
      visitExpr(expr.object, info, gInfo, inLoop);
      for (const a of expr.args) visitExpr(a, info, gInfo, inLoop);
      return;
    case "call_closure":
      visitExpr(expr.callee, info, gInfo, inLoop);
      for (const a of expr.args) visitExpr(a, info, gInfo, inLoop);
      return;
    case "conditional":
      visitExpr(expr.condition, info, gInfo, inLoop);
      visitExpr(expr.then, info, gInfo, inLoop);
      visitExpr(expr.else, info, gInfo, inLoop);
      return;
    case "field_get":
      visitExpr(expr.object, info, gInfo, inLoop);
      return;
    case "field_set":
      visitExpr(expr.object, info, gInfo, inLoop);
      visitExpr(expr.value, info, gInfo, inLoop);
      return;
    case "index_get":
      visitExpr(expr.array, info, gInfo, inLoop);
      visitExpr(expr.index, info, gInfo, inLoop);
      return;
    case "index_set":
      visitExpr(expr.array, info, gInfo, inLoop);
      visitExpr(expr.index, info, gInfo, inLoop);
      visitExpr(expr.value, info, gInfo, inLoop);
      return;
    case "narrow_i64":
    case "widen_f64":
    case "box":
    case "unbox":
    case "await":
    case "wrap_interface":
      visitExpr(expr.value, info, gInfo, inLoop);
      return;
    case "alloc_array":
      for (const v of expr.initialValues) visitExpr(v, info, gInfo, inLoop);
      return;
    case "alloc_struct":
      for (const v of expr.fields) visitExpr(v, info, gInfo, inLoop);
      return;
    case "nullish_coalesce":
      visitExpr(expr.left, info, gInfo, inLoop);
      visitExpr(expr.right, info, gInfo, inLoop);
      return;
    case "array_hof":
      visitExpr(expr.array, info, gInfo, inLoop);
      visitExpr(expr.callback, info, gInfo, inLoop);
      return;
    default:
      return;
  }
}

function visitStmt(
  stmt: HIRStmt,
  info: Map<number, LocalInfo>,
  gInfo: Map<string, GlobalInfo>,
  inLoop: boolean,
): void {
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
        if (init) visitExpr(init, info, gInfo, inLoop);
      } else if (stmt.init) {
        visitExpr(stmt.init, info, gInfo, inLoop);
      }
      return;
    case "expr":
      visitExpr(stmt.expr, info, gInfo, inLoop);
      return;
    case "return":
      if (stmt.value) visitExpr(stmt.value, info, gInfo, inLoop);
      return;
    case "if":
      visitExpr(stmt.condition, info, gInfo, inLoop);
      stmt.then.forEach((s) => visitStmt(s, info, gInfo, inLoop));
      stmt.else?.forEach((s) => visitStmt(s, info, gInfo, inLoop));
      return;
    case "while":
      visitExpr(stmt.condition, info, gInfo, true);
      stmt.body.forEach((s) => visitStmt(s, info, gInfo, true));
      return;
    case "for":
      if (stmt.init) visitStmt(stmt.init, info, gInfo, inLoop);
      if (stmt.condition) visitExpr(stmt.condition, info, gInfo, true);
      if (stmt.update) visitExpr(stmt.update, info, gInfo, true);
      stmt.body.forEach((s) => visitStmt(s, info, gInfo, true));
      return;
    case "throw":
      visitExpr(stmt.value, info, gInfo, inLoop);
      return;
    case "try":
      stmt.body.forEach((s) => visitStmt(s, info, gInfo, inLoop));
      stmt.catch?.body.forEach((s) => visitStmt(s, info, gInfo, inLoop));
      stmt.finally?.forEach((s) => visitStmt(s, info, gInfo, inLoop));
      return;
    case "switch":
      visitExpr(stmt.discriminant, info, gInfo, inLoop);
      for (const c of stmt.cases) {
        if (c.test) visitExpr(c.test, info, gInfo, inLoop);
        c.body.forEach((s) => visitStmt(s, info, gInfo, inLoop));
      }
      return;
    default:
      return;
  }
}

function rewriteExpr(expr: HIRExpr, el: Eligibility): HIRExpr {
  switch (expr.kind) {
    case "local_set": {
      if (el.locals.has(expr.id) && isAppendOf(expr.id, expr.value)) {
        return { ...expr, value: rewriteConcatChainLocal(expr.value, expr.id, el) };
      }
      return { ...expr, value: rewriteExpr(expr.value, el) };
    }
    case "global_set": {
      if (el.globals.has(expr.name) && isAppendOfGlobal(expr.name, expr.value)) {
        return { ...expr, value: rewriteConcatChainGlobal(expr.value, expr.name, el) };
      }
      if (el.globals.has(expr.name) && expr.value.kind === "literal_string") {
        return {
          ...expr,
          value: {
            kind: "runtime_call",
            func: "cs2_string_builder_init",
            args: [expr.value],
            returnType: I8PTR,
            type: I8PTR,
          },
        };
      }
      return { ...expr, value: rewriteExpr(expr.value, el) };
    }
    case "binary":
      return { ...expr, left: rewriteExpr(expr.left, el), right: rewriteExpr(expr.right, el) };
    case "unary":
      return { ...expr, operand: rewriteExpr(expr.operand, el) };
    case "call":
    case "runtime_call":
      return { ...expr, args: expr.args.map((a) => rewriteExpr(a, el)) };
    case "vtable_call":
      return { ...expr, object: rewriteExpr(expr.object, el), args: expr.args.map((a) => rewriteExpr(a, el)) };
    case "call_closure":
      return { ...expr, callee: rewriteExpr(expr.callee, el), args: expr.args.map((a) => rewriteExpr(a, el)) };
    case "conditional":
      return {
        ...expr,
        condition: rewriteExpr(expr.condition, el),
        then: rewriteExpr(expr.then, el),
        else: rewriteExpr(expr.else, el),
      };
    case "field_get":
      return { ...expr, object: rewriteExpr(expr.object, el) };
    case "field_set":
      return { ...expr, object: rewriteExpr(expr.object, el), value: rewriteExpr(expr.value, el) };
    case "index_get":
      return { ...expr, array: rewriteExpr(expr.array, el), index: rewriteExpr(expr.index, el) };
    case "index_set":
      return { ...expr, array: rewriteExpr(expr.array, el), index: rewriteExpr(expr.index, el), value: rewriteExpr(expr.value, el) };
    case "narrow_i64":
    case "widen_f64":
    case "box":
    case "unbox":
    case "await":
    case "wrap_interface":
      return { ...expr, value: rewriteExpr(expr.value, el) };
    case "alloc_array":
      return { ...expr, initialValues: expr.initialValues.map((v) => rewriteExpr(v, el)) };
    case "alloc_struct":
      return { ...expr, fields: expr.fields.map((v) => rewriteExpr(v, el)) };
    case "nullish_coalesce":
      return { ...expr, left: rewriteExpr(expr.left, el), right: rewriteExpr(expr.right, el) };
    case "array_hof":
      return { ...expr, array: rewriteExpr(expr.array, el), callback: rewriteExpr(expr.callback, el) };
    default:
      return expr;
  }
}

function rewriteStmt(stmt: HIRStmt, el: Eligibility): HIRStmt {
  switch (stmt.kind) {
    case "let":
      if (el.locals.has(stmt.id) && stmt.init && stmt.init.kind === "literal_string") {
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
      return { ...stmt, init: stmt.init ? rewriteExpr(stmt.init, el) : stmt.init };
    case "expr":
      return { ...stmt, expr: rewriteExpr(stmt.expr, el) };
    case "return":
      return { ...stmt, value: stmt.value ? rewriteExpr(stmt.value, el) : stmt.value };
    case "if":
      return {
        ...stmt,
        condition: rewriteExpr(stmt.condition, el),
        then: stmt.then.map((s) => rewriteStmt(s, el)),
        else: stmt.else?.map((s) => rewriteStmt(s, el)),
      };
    case "while":
      return {
        ...stmt,
        condition: rewriteExpr(stmt.condition, el),
        body: stmt.body.map((s) => rewriteStmt(s, el)),
      };
    case "for":
      return {
        ...stmt,
        init: stmt.init ? rewriteStmt(stmt.init, el) : stmt.init,
        condition: stmt.condition ? rewriteExpr(stmt.condition, el) : stmt.condition,
        update: stmt.update ? rewriteExpr(stmt.update, el) : stmt.update,
        body: stmt.body.map((s) => rewriteStmt(s, el)),
      };
    case "throw":
      return { ...stmt, value: rewriteExpr(stmt.value, el) };
    case "try":
      return {
        ...stmt,
        body: stmt.body.map((s) => rewriteStmt(s, el)),
        catch: stmt.catch ? { ...stmt.catch, body: stmt.catch.body.map((s) => rewriteStmt(s, el)) } : stmt.catch,
        finally: stmt.finally?.map((s) => rewriteStmt(s, el)),
      };
    case "switch":
      return {
        ...stmt,
        discriminant: rewriteExpr(stmt.discriminant, el),
        cases: stmt.cases.map((c) => ({
          ...c,
          test: c.test ? rewriteExpr(c.test, el) : c.test,
          body: c.body.map((s) => rewriteStmt(s, el)),
        })),
      };
    default:
      return stmt;
  }
}

function processBody(body: HIRStmt[], gInfo: Map<string, GlobalInfo>, eligibleGlobals: Set<string>): HIRStmt[] {
  const info = new Map<number, LocalInfo>();
  for (const s of body) visitStmt(s, info, gInfo, false);
  const eligibleLocals = new Set<number>();
  for (const [_ck, li] of info) {
    if (li.hasIncompatibleWrite) continue;
    if (!li.declaredHere) continue;
    if (!li.initIsStringLiteral) continue;
    if (li.appendSites < 1) continue;
    eligibleLocals.add(li.id);
  }
  if (eligibleLocals.size === 0 && eligibleGlobals.size === 0) return body;
  const el: Eligibility = { locals: eligibleLocals, globals: eligibleGlobals };
  return body.map((s) => rewriteStmt(s, el));
}

function visitOnlyForGlobals(body: HIRStmt[], gInfo: Map<string, GlobalInfo>): void {
  const dummy = new Map<number, LocalInfo>();
  for (const s of body) visitStmt(s, dummy, gInfo, false);
}

export function concatBuilderPass(mod: HIRModule): void {
  const gInfo = new Map<string, GlobalInfo>();
  for (const g of mod.globals) {
    if (!g.mutable) continue;
    if (g.type.kind !== "i8ptr") continue;
    if (g.init && g.init.kind !== "literal_string") continue;
    gInfo.set(g.name, { name: g.name, appendSites: 0, hasIncompatibleWrite: false });
  }

  for (const fn of mod.functions) visitOnlyForGlobals(fn.body, gInfo);
  for (const cls of mod.classes) {
    for (const m of cls.methods) visitOnlyForGlobals(m.body, gInfo);
  }
  visitOnlyForGlobals(mod.init, gInfo);

  const eligibleGlobals = new Set<string>();
  for (const [_gk, gi] of gInfo) {
    if (gi.hasIncompatibleWrite) continue;
    if (gi.appendSites < 1) continue;
    eligibleGlobals.add(gi.name);
  }

  for (const fn of mod.functions) {
    fn.body = processBody(fn.body, gInfo, eligibleGlobals);
  }
  for (const cls of mod.classes) {
    for (const m of cls.methods) {
      m.body = processBody(m.body, gInfo, eligibleGlobals);
    }
  }
  mod.init = processBody(mod.init, gInfo, eligibleGlobals);

  for (const g of mod.globals) {
    if (eligibleGlobals.has(g.name) && g.init && g.init.kind === "literal_string") {
      g.init = {
        kind: "runtime_call",
        func: "cs2_string_builder_init",
        args: [g.init],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
  }
}
