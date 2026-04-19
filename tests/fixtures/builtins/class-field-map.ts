// @test expectTestPassed
interface Req {
  seq: number;
  cmd: string;
}
class S {
  pending: Map<string, Req> = new Map();
  counts: Map<string, number> = new Map();
}
const s = new S();
s.pending.set("1", { seq: 1, cmd: "init" });
s.counts.set("x", 42);
if (s.pending.has("1") && s.counts.has("x") && s.counts.get("x") === 42) {
  console.log("TEST_PASSED");
}
