// Unit tests for the typed IR builder's structural guarantees — the invariants that replace
// v1's string-concat IR. Pure, no clang needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BasicBlock, FuncBuilder, ModuleBuilder, imm } from "../../src/ir/builder.js";
import { T } from "../../src/ir/types.js";

test("block rejects instructions after its terminator", () => {
  const b = new BasicBlock("entry");
  b.add("call void @f()");
  b.terminate("ret void");
  assert.equal(b.isTerminated, true);
  assert.throws(() => b.add("call void @g()"), /terminated block/);
});

test("block rejects double termination", () => {
  const b = new BasicBlock("entry");
  b.terminate("ret void");
  assert.throws(() => b.terminate("ret void"), /terminated twice/);
});

test("finish() fails when a block has no terminator", () => {
  const fn = new FuncBuilder("main", T.i32, []);
  assert.throws(() => fn.finish(), /no terminator/);
});

test("ret rejects a void-typed value", () => {
  const fn = new FuncBuilder("f", T.void, []);
  assert.throws(() => fn.ret(imm(T.void, "x")), /void value/);
});

test("a minimal function renders valid-looking IR", () => {
  const fn = new FuncBuilder("main", T.i32, []);
  fn.ret(imm(T.i32, 0));
  const ir = fn.finish();
  assert.match(ir, /define i32 @main\(\) \{/);
  assert.match(ir, /ret i32 0/);
});

test("cstring interns a {ptr,len} CsString and returns a ptr value", () => {
  const mod = new ModuleBuilder();
  const v = mod.cstring("hi");
  assert.equal(v.type.kind, "ptr");
  const ir = mod.render();
  // UTF-8 {data,len} ABI: raw bytes (NO trailing NUL — length is carried) + a {ptr,i64} header.
  assert.match(ir, /@\.str0\.data = private unnamed_addr constant \[2 x i8\] c"\\68\\69"/);
  assert.match(
    ir,
    /@\.str0 = private unnamed_addr constant \{ ptr, i64 \} \{ ptr @\.str0\.data, i64 2 \}/,
  );
});

test("cstring of the empty string carries len 0", () => {
  const mod = new ModuleBuilder();
  mod.cstring("");
  const ir = mod.render();
  assert.match(ir, /@\.str0\.data = private unnamed_addr constant \[1 x i8\] zeroinitializer/);
  assert.match(
    ir,
    /@\.str0 = private unnamed_addr constant \{ ptr, i64 \} \{ ptr @\.str0\.data, i64 0 \}/,
  );
});

test("allocas render at the top of the entry block, before other instructions", () => {
  const fn = new FuncBuilder("main", T.void, []);
  fn.callVoid("@side_effect", []); // a non-alloca instruction emitted first
  const slot = fn.alloca(T.double); // alloca requested AFTER it
  fn.store(imm(T.double, "0x0000000000000000"), slot);
  fn.retVoid();
  const ir = fn.finish();
  // The alloca line must precede the call, even though alloca() was called later.
  assert.ok(ir.indexOf("= alloca double") < ir.indexOf("call void @side_effect"));
});

test("declareExtern dedups and render wires a call", () => {
  const mod = new ModuleBuilder();
  mod.declareExtern("cs_console_log_cstr", T.void, [T.ptr]);
  mod.declareExtern("cs_console_log_cstr", T.void, [T.ptr]); // dup ignored
  const fn = mod.defineFunc("main", T.i32, []);
  fn.callVoid("@cs_console_log_cstr", [mod.cstring("x")]);
  fn.ret(imm(T.i32, 0));
  const ir = mod.render();
  assert.equal(ir.match(/declare void @cs_console_log_cstr/g)?.length, 1);
  assert.match(ir, /call void @cs_console_log_cstr\(ptr @\.str\d+\)/);
});
