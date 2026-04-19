import { describe, it } from "node:test";
import assert from "node:assert";
import { TrampolineEmitter } from "../../src/codegen/infrastructure/trampoline-emitter.js";

describe("TrampolineEmitter", () => {
  it("deduplicates identical shapes", () => {
    const e = new TrampolineEmitter();
    const a = e.ensureTrampoline({
      llvmSig: "void(i8*)",
      argTypes: ["i8*"],
      returnType: "void",
    });
    const b = e.ensureTrampoline({
      llvmSig: "void(i8*)",
      argTypes: ["i8*"],
      returnType: "void",
    });
    assert.strictEqual(a, b);
    assert.strictEqual(e.listRegisteredNames().length, 1);
  });

  it("emits distinct functions for distinct shapes", () => {
    const e = new TrampolineEmitter();
    const a = e.ensureTrampoline({
      llvmSig: "void(i8*)",
      argTypes: ["i8*"],
      returnType: "void",
    });
    const b = e.ensureTrampoline({
      llvmSig: "void(i8*,double)",
      argTypes: ["i8*", "double"],
      returnType: "void",
    });
    assert.notStrictEqual(a, b);
    assert.strictEqual(e.listRegisteredNames().length, 2);
  });

  it("emitAll contains the registered function names", () => {
    const e = new TrampolineEmitter();
    const name = e.ensureTrampoline({
      llvmSig: "void(i8*,double)",
      argTypes: ["i8*", "double"],
      returnType: "void",
    });
    const ir = e.emitAll();
    // `name` is like "@__cs_tramp_void_i8p_double"; the `define` strips the leading @
    const bareName = name.substring(1);
    assert.ok(
      ir.includes("define void @" + bareName + "("),
      "emitAll output should contain the trampoline definition",
    );
    assert.ok(ir.includes("%__TrampEnv_S_void_i8p_double"), "env struct type should be emitted");
    assert.ok(ir.includes("ret void"));
  });

  it("emitAll is empty when no shapes were registered", () => {
    const e = new TrampolineEmitter();
    assert.strictEqual(e.emitAll(), "");
  });
});
