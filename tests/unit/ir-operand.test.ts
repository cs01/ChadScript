import { describe, it } from "node:test";
import assert from "node:assert";
import {
  symbolRef,
  userGlobalRef,
  internalGlobalRef,
  operand,
  operandList,
} from "../../src/codegen/infrastructure/ir-operand.js";

const mockCtx = {
  mangleUserName(name: string): string {
    if (name.startsWith("__")) return name;
    return `_cs_${name}`;
  },
};

describe("ir-operand", () => {
  describe("symbolRef", () => {
    it("prefixes global symbols with @", () => {
      assert.strictEqual(symbolRef("foo", "@"), "@foo");
    });

    it("prefixes local symbols with %", () => {
      assert.strictEqual(symbolRef("1", "%"), "%1");
      assert.strictEqual(symbolRef("tmp", "%"), "%tmp");
    });

    it("rejects empty names", () => {
      assert.throws(() => symbolRef("", "@"), /empty symbol name/);
    });

    it("rejects already-sigiled names", () => {
      assert.throws(() => symbolRef("@foo", "@"), /already sigiled/);
      assert.throws(() => symbolRef("%tmp", "%"), /already sigiled/);
    });
  });

  describe("userGlobalRef", () => {
    it("mangles user names with _cs_ prefix", () => {
      assert.strictEqual(userGlobalRef(mockCtx, "foo"), "@_cs_foo");
    });

    it("skips mangling for __-prefixed internals", () => {
      assert.strictEqual(userGlobalRef(mockCtx, "__internal"), "@__internal");
    });
  });

  describe("internalGlobalRef", () => {
    it("emits without mangling", () => {
      assert.strictEqual(internalGlobalRef("GC_malloc"), "@GC_malloc");
      assert.strictEqual(internalGlobalRef("http_serve"), "@http_serve");
    });
  });

  describe("operand", () => {
    it("binds type and value", () => {
      assert.strictEqual(operand("i8*", "%1"), "i8* %1");
      assert.strictEqual(operand("double", "3.14"), "double 3.14");
    });

    it("rejects empty type or value", () => {
      assert.throws(() => operand("", "%1"), /empty type string/);
      assert.throws(() => operand("i8*", ""), /empty value string/);
    });
  });

  describe("operandList", () => {
    it("joins parallel type/value arrays with commas", () => {
      assert.strictEqual(operandList(["i32", "i8*"], ["%0", "%1"]), "i32 %0, i8* %1");
    });

    it("returns empty string for empty arrays", () => {
      assert.strictEqual(operandList([], []), "");
    });

    it("rejects length mismatch", () => {
      assert.throws(() => operandList(["i32"], ["%0", "%1"]), /length mismatch/);
    });
  });
});
