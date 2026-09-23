// Variable storage: stack slots, and heap cells for bindings a closure shares (lower/cells.ts).
//
// A cell is an 8-byte GC allocation holding the variable in its machine representation. The frame
// keeps the cell POINTER in a stack slot, and lookupVar loads it at each use, so reads and writes
// everywhere (including every closure holding the same pointer in its env) hit one storage
// location. Keeping the pointer in a slot rather than an SSA value is what lets a loop give each
// iteration a new cell: the swap is a store, and nothing downstream has to dominate it.

import { ice } from "../diagnostics.js";
import { imm, type Value } from "../ir/builder.js";
import { T } from "../ir/types.js";
import type { ValueType } from "../hir/types.js";
import type { HExpr } from "../hir/nodes.js";
import { boxSlot, irTypeOf, lookupVar, type Ctx } from "./expr.js";

function newCell(init: Value, ctx: Ctx): Value {
  const cell = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, 8)]);
  ctx.fn.store(init, cell);
  return cell;
}

// Bind `name` to fresh storage holding `init()`: a cell when `cell` is set, else a stack slot.
// `init` is a thunk so a stack slot is allocated before the initializer is emitted, keeping the
// IR of programs without cells byte-identical to what it was before cells existed.
export function bindVar(
  name: string,
  vtype: ValueType,
  init: () => Value,
  cell: boolean | undefined,
  ctx: Ctx,
): void {
  if (cell) {
    bindCellPtr(name, vtype, newCell(init(), ctx), ctx);
    return;
  }
  const ptr = ctx.fn.alloca(irTypeOf(vtype));
  ctx.fn.store(init(), ptr);
  ctx.vars.set(name, { ptr, vtype });
}

// Bind `name` to an existing cell (a by-reference capture unpacked from a closure env).
export function bindCellPtr(name: string, vtype: ValueType, cellPtr: Value, ctx: Ctx): void {
  const slot = ctx.fn.alloca(T.ptr);
  ctx.fn.store(cellPtr, slot);
  ctx.vars.set(name, { ptr: slot, vtype, cell: true });
}

// The cell a by-reference capture shares. Only a cell variable of this frame can be captured by
// reference: handing out a stack slot's address would dangle once the frame returns.
export function capturedCell(name: string, ctx: Ctx): Value {
  if (!ctx.vars.get(name)?.cell) ice(`codegen: by-reference capture of non-cell variable ${name}`);
  return lookupVar(name, ctx).ptr;
}

// Move a cell variable to a fresh cell holding its current value: the per-iteration binding of a
// `for (let ...)` header (CreatePerIterationEnvironment). Closures made earlier keep the old cell.
export function renewCell(name: string, ctx: Ctx): void {
  const entry = ctx.vars.get(name);
  if (!entry?.cell) return ice(`codegen: per-iteration binding ${name} is not a cell`);
  const current = ctx.fn.load(irTypeOf(entry.vtype), ctx.fn.load(T.ptr, entry.ptr));
  ctx.fn.store(newCell(current, ctx), entry.ptr);
}

// Create a closure: a GC record {fnptr, env, display}. `env` holds the captured values (or null
// when there are no captures); captures are read from the enclosing scope at creation time.
// `display` is the function's util.inspect text, read when an object holding it is printed.
export function evalClosure(expr: Extract<HExpr, { kind: "closure" }>, ctx: Ctx): Value {
  if (expr.identity !== undefined) {
    // One JS function object: a static record, the same address on every evaluation. Its env
    // word (unused by the wrapper, which captures nothing) is the function's identity token,
    // shared by every wrapper of it, which is what functionIdentityEq compares.
    if (expr.captures.length > 0) return ice("codegen: an identity closure cannot capture");
    const token = ctx.mod.defineZeroWords(`fnid.${expr.identity}`, 1);
    return ctx.mod.defineWordRecord(`closure.${expr.lambdaName}`, [
      ctx.fn.funcRef(expr.lambdaName),
      token,
      ctx.mod.internedString(expr.display),
    ]);
  }
  let env: Value;
  if (expr.captures.length > 0) {
    env = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, expr.captures.length * 8)]);
    expr.captures.forEach((c, i) => {
      // A by-reference capture shares the cell itself, not a copy of its value.
      if (c.byRef) {
        ctx.fn.store(ctx.fn.ptrToI64(capturedCell(c.name, ctx)), ctx.fn.gepSlot(env, i));
        return;
      }
      const slot = lookupVar(c.name, ctx);
      const v = ctx.fn.load(irTypeOf(c.type), slot.ptr);
      ctx.fn.store(boxSlot(v, c.type, ctx), ctx.fn.gepSlot(env, i));
    });
  } else {
    env = ctx.fn.nullPtr();
  }
  const rec = ctx.fn.call("@cs_gc_alloc", T.ptr, [imm(T.i64, 24)]);
  ctx.fn.store(ctx.fn.ptrToI64(ctx.fn.funcRef(expr.lambdaName)), ctx.fn.gepSlot(rec, 0));
  ctx.fn.store(ctx.fn.ptrToI64(env), ctx.fn.gepSlot(rec, 1));
  ctx.fn.store(ctx.mod.internedString(expr.display), ctx.fn.gepSlot(rec, 2));
  return rec;
}
