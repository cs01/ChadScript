// @expect-reject: CS1232
// `lib.work` through a namespace is the async function itself; as a value it must be rejected just
// like a direct `work` reference (a forwarding wrapper would not spawn a fiber).
import * as lib from "./lib";

const f = lib.work;
f();
