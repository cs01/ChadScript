import type { HIRModule, HIRExpr, HIRStmt, HIRFunction, HIRType } from "../hir/types.js";

const ALLOC_KINDS = new Set([
  "alloc_struct",
  "alloc_dynobj",
  "alloc_dynarray",
  "alloc_array",
]);

function isAllocExpr(e: HIRExpr): boolean {
  if (ALLOC_KINDS.has(e.kind as string)) return true;
  if (e.kind === "call" && e.type.kind === "ptr") return true;
  return false;
}

interface AnalysisCtx {
  allocLocals: Set<number>;
  escaped: Set<number>;
  hasAlloc: boolean;
  hasUnknownEscape: boolean;
}

function visitExprForEscape(e: HIRExpr | undefined, ctx: AnalysisCtx, escapeNext: boolean): void {
  if (!e) return;
  switch (e.kind) {
    case "local_get":
      if (escapeNext && ctx.allocLocals.has(e.id)) ctx.escaped.add(e.id);
      return;
    case "local_set":
      visitExprForEscape(e.value, ctx, false);
      return;
    case "global_set":
      visitExprForEscape(e.value, ctx, true);
      return;
    case "global_get":
      return;
    case "field_get":
      visitExprForEscape(e.object, ctx, false);
      return;
    case "field_set":
      visitExprForEscape(e.object, ctx, false);
      visitExprForEscape(e.value, ctx, true);
      return;
    case "index_get":
      visitExprForEscape(e.array, ctx, false);
      visitExprForEscape(e.index, ctx, false);
      return;
    case "index_set":
      visitExprForEscape(e.array, ctx, false);
      visitExprForEscape(e.index, ctx, false);
      visitExprForEscape(e.value, ctx, true);
      return;
    case "binary":
      visitExprForEscape(e.left, ctx, false);
      visitExprForEscape(e.right, ctx, false);
      return;
    case "unary":
      visitExprForEscape(e.operand, ctx, false);
      return;
    case "runtime_call":
      for (const a of e.args) visitExprForEscape(a, ctx, false);
      return;
    case "vtable_call":
      visitExprForEscape(e.object, ctx, true);
      for (const a of e.args) visitExprForEscape(a, ctx, true);
      return;
    case "call_closure":
      visitExprForEscape(e.callee, ctx, true);
      for (const a of e.args) visitExprForEscape(a, ctx, true);
      return;
    case "conditional":
      visitExprForEscape(e.condition, ctx, false);
      visitExprForEscape(e.then, ctx, escapeNext);
      visitExprForEscape(e.else, ctx, escapeNext);
      return;
    case "narrow_i64":
    case "widen_f64":
    case "box":
    case "unbox":
    case "await":
    case "wrap_interface":
      visitExprForEscape(e.value, ctx, escapeNext);
      return;
    case "alloc_struct":
      ctx.hasAlloc = true;
      for (const f of e.fields) visitExprForEscape(f, ctx, true);
      return;
    case "call":
      if (e.type.kind === "ptr") ctx.hasAlloc = true;
      for (const a of e.args) visitExprForEscape(a, ctx, true);
      return;
    case "alloc_dynobj":
      ctx.hasAlloc = true;
      for (const p of e.props) visitExprForEscape(p.value, ctx, true);
      if (e.spreadSource) visitExprForEscape(e.spreadSource, ctx, true);
      return;
    case "alloc_dynarray":
      ctx.hasAlloc = true;
      for (const v of e.initialValues) visitExprForEscape(v, ctx, true);
      return;
    case "alloc_array":
      ctx.hasAlloc = true;
      for (const v of e.initialValues) visitExprForEscape(v, ctx, true);
      return;
    case "alloc_array_spread":
    case "alloc_map":
    case "alloc_set":
      ctx.hasUnknownEscape = true;
      return;
    case "make_closure":
      ctx.hasUnknownEscape = true;
      return;
    default:
      return;
  }
}

function trackAllocLocals(e: HIRExpr | undefined, allocLocals: Set<number>): void {
  if (!e) return;
  if (e.kind === "local_set" && isAllocExpr(e.value)) allocLocals.add(e.id);
  switch (e.kind) {
    case "binary":
      trackAllocLocals(e.left, allocLocals);
      trackAllocLocals(e.right, allocLocals);
      return;
    case "conditional":
      trackAllocLocals(e.condition, allocLocals);
      trackAllocLocals(e.then, allocLocals);
      trackAllocLocals(e.else, allocLocals);
      return;
    default:
      return;
  }
}

function visitStmtForLocals(s: HIRStmt, allocLocals: Set<number>): void {
  switch (s.kind) {
    case "let":
      if (s.init && isAllocExpr(s.init)) allocLocals.add(s.id);
      if (s.init) trackAllocLocals(s.init, allocLocals);
      return;
    case "expr":
      trackAllocLocals(s.expr, allocLocals);
      return;
    case "if":
      s.then.forEach((c) => visitStmtForLocals(c, allocLocals));
      s.else?.forEach((c) => visitStmtForLocals(c, allocLocals));
      return;
    case "while":
      s.body.forEach((c) => visitStmtForLocals(c, allocLocals));
      return;
    case "for":
      if (s.init) visitStmtForLocals(s.init, allocLocals);
      s.body.forEach((c) => visitStmtForLocals(c, allocLocals));
      return;
    case "switch":
      for (const c of s.cases) c.body.forEach((b) => visitStmtForLocals(b, allocLocals));
      return;
    case "try":
      s.body.forEach((c) => visitStmtForLocals(c, allocLocals));
      s.catch?.body.forEach((c) => visitStmtForLocals(c, allocLocals));
      s.finally?.forEach((c) => visitStmtForLocals(c, allocLocals));
      return;
    default:
      return;
  }
}

function visitStmtForEscape(s: HIRStmt, ctx: AnalysisCtx): void {
  switch (s.kind) {
    case "let":
      if (s.init) visitExprForEscape(s.init, ctx, false);
      return;
    case "expr":
      visitExprForEscape(s.expr, ctx, false);
      return;
    case "return":
      if (s.value) visitExprForEscape(s.value, ctx, true);
      return;
    case "if":
      visitExprForEscape(s.condition, ctx, false);
      s.then.forEach((c) => visitStmtForEscape(c, ctx));
      s.else?.forEach((c) => visitStmtForEscape(c, ctx));
      return;
    case "while":
      visitExprForEscape(s.condition, ctx, false);
      s.body.forEach((c) => visitStmtForEscape(c, ctx));
      return;
    case "for":
      if (s.init) visitStmtForEscape(s.init, ctx);
      if (s.condition) visitExprForEscape(s.condition, ctx, false);
      if (s.update) visitExprForEscape(s.update, ctx, false);
      s.body.forEach((c) => visitStmtForEscape(c, ctx));
      return;
    case "throw":
      visitExprForEscape(s.value, ctx, true);
      return;
    case "switch":
      visitExprForEscape(s.discriminant, ctx, false);
      for (const c of s.cases) {
        if (c.test) visitExprForEscape(c.test, ctx, false);
        c.body.forEach((b) => visitStmtForEscape(b, ctx));
      }
      return;
    case "try":
      s.body.forEach((c) => visitStmtForEscape(c, ctx));
      s.catch?.body.forEach((c) => visitStmtForEscape(c, ctx));
      s.finally?.forEach((c) => visitStmtForEscape(c, ctx));
      return;
    default:
      return;
  }
}

function markAllocsArena(s: HIRStmt): HIRStmt {
  function rew(e: HIRExpr): HIRExpr {
    if (e.kind === "alloc_struct") return { ...e, placement: "arena" as const, fields: e.fields.map(rew) };
    switch (e.kind) {
      case "binary":
        return { ...e, left: rew(e.left), right: rew(e.right) };
      case "unary":
        return { ...e, operand: rew(e.operand) };
      case "call":
      case "runtime_call":
        return { ...e, args: e.args.map(rew) };
      case "conditional":
        return { ...e, condition: rew(e.condition), then: rew(e.then), else: rew(e.else) };
      case "field_get":
        return { ...e, object: rew(e.object) };
      case "field_set":
        return { ...e, object: rew(e.object), value: rew(e.value) };
      case "index_get":
        return { ...e, array: rew(e.array), index: rew(e.index) };
      case "index_set":
        return { ...e, array: rew(e.array), index: rew(e.index), value: rew(e.value) };
      case "local_set":
        return { ...e, value: rew(e.value) };
      case "global_set":
        return { ...e, value: rew(e.value) };
      case "narrow_i64":
      case "widen_f64":
      case "box":
      case "unbox":
      case "wrap_interface":
        return { ...e, value: rew(e.value) };
      default:
        return e;
    }
  }
  switch (s.kind) {
    case "let":
      return { ...s, init: s.init ? rew(s.init) : s.init };
    case "expr":
      return { ...s, expr: rew(s.expr) };
    case "return":
      return { ...s, value: s.value ? rew(s.value) : s.value };
    case "if":
      return {
        ...s,
        condition: rew(s.condition),
        then: s.then.map(markAllocsArena),
        else: s.else?.map(markAllocsArena),
      };
    case "while":
      return { ...s, condition: rew(s.condition), body: s.body.map(markAllocsArena) };
    case "for":
      return {
        ...s,
        init: s.init ? markAllocsArena(s.init) : s.init,
        condition: s.condition ? rew(s.condition) : s.condition,
        update: s.update ? rew(s.update) : s.update,
        body: s.body.map(markAllocsArena),
      };
    case "switch":
      return {
        ...s,
        discriminant: rew(s.discriminant),
        cases: s.cases.map((c) => ({
          ...c,
          test: c.test ? rew(c.test) : c.test,
          body: c.body.map(markAllocsArena),
        })),
      };
    default:
      return s;
  }
}

function makeArenaCallStmt(name: string): HIRStmt {
  return {
    kind: "expr",
    expr: {
      kind: "runtime_call",
      func: name,
      args: [],
      returnType: { kind: "void" },
      type: { kind: "void" },
    },
  } as HIRStmt;
}

function arenifyForLoop(s: HIRStmt): HIRStmt {
  if (s.kind !== "for" && s.kind !== "while") return s;

  const ctx: AnalysisCtx = {
    allocLocals: new Set(),
    escaped: new Set(),
    hasAlloc: false,
    hasUnknownEscape: false,
  };

  const body = s.kind === "for"
    ? (s.init ? [s.init, ...s.body] : s.body)
    : s.body;
  for (const c of body) visitStmtForLocals(c, ctx.allocLocals);
  for (const c of s.body) visitStmtForEscape(c, ctx);

  if (!ctx.hasAlloc) return s;
  if (ctx.hasUnknownEscape) return s;
  for (const id of ctx.allocLocals) {
    if (ctx.escaped.has(id)) return s;
  }

  const newBody = [
    makeArenaCallStmt("cs2_arena_save"),
    ...s.body.map(markAllocsArena),
    makeArenaCallStmt("cs2_arena_restore"),
  ];
  return { ...s, body: newBody };
}

function recurseStmt(s: HIRStmt): HIRStmt {
  if (s.kind === "for") {
    const inner = { ...s, body: s.body.map(recurseStmt) };
    return arenifyForLoop(inner);
  }
  if (s.kind === "while") {
    const inner = { ...s, body: s.body.map(recurseStmt) };
    return arenifyForLoop(inner);
  }
  switch (s.kind) {
    case "if":
      return { ...s, then: s.then.map(recurseStmt), else: s.else?.map(recurseStmt) };
    case "switch":
      return { ...s, cases: s.cases.map((c) => ({ ...c, body: c.body.map(recurseStmt) })) };
    case "try":
      return {
        ...s,
        body: s.body.map(recurseStmt),
        catch: s.catch ? { ...s.catch, body: s.catch.body.map(recurseStmt) } : s.catch,
        finally: s.finally?.map(recurseStmt),
      };
    default:
      return s;
  }
}

function processBody(body: HIRStmt[]): HIRStmt[] {
  return body.map(recurseStmt);
}

export function arenifyLoopsPass(mod: HIRModule): void {
  for (const fn of mod.functions) fn.body = processBody(fn.body);
  for (const cls of mod.classes) for (const m of cls.methods) m.body = processBody(m.body);
  mod.init = processBody(mod.init);
}
