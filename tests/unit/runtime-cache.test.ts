// The runtime .o cache is content-addressed: its key must be stable for identical inputs (cache
// hit → no recompile) and change whenever the .c source, any runtime header, or the compile flags
// change (cache miss → rebuild, never a stale object). These pin that key function.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeObjectKey } from "../../src/driver/build.js";

const c = Buffer.from("int cs_foo(void){return 1;}");
const hdrs = [Buffer.from("#define A 1"), Buffer.from("#define B 2")];
const flags = ["-O2", "-c", "-DNDEBUG"];

test("identical inputs produce identical keys (cache hit)", () => {
  assert.equal(runtimeObjectKey(c, hdrs, flags), runtimeObjectKey(c, hdrs, flags));
});

test("changed source content changes the key", () => {
  const c2 = Buffer.from("int cs_foo(void){return 2;}");
  assert.notEqual(runtimeObjectKey(c, hdrs, flags), runtimeObjectKey(c2, hdrs, flags));
});

test("changed header content changes the key (header edit rebuilds the .c)", () => {
  const hdrs2 = [Buffer.from("#define A 999"), Buffer.from("#define B 2")];
  assert.notEqual(runtimeObjectKey(c, hdrs, flags), runtimeObjectKey(c, hdrs2, flags));
});

test("changed compile flags change the key", () => {
  assert.notEqual(runtimeObjectKey(c, hdrs, flags), runtimeObjectKey(c, hdrs, ["-O0", "-c"]));
});

test("the key is a short hex digest", () => {
  assert.match(runtimeObjectKey(c, hdrs, flags), /^[0-9a-f]{16}$/);
});
