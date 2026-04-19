// @test expectTestPassed
// Previously `s.pending.keys()` on a class-field Map lost return-type
// tracking and the result defaulted to `number`, making `.length` and
// for-of iteration fail with '.length is not available on type number'.
interface Req {
  seq: number;
}
class S {
  pending: Map<string, Req> = new Map();
}
const s = new S();
s.pending.set("1", { seq: 1 });
s.pending.set("2", { seq: 2 });
const ks = s.pending.keys();
let count = 0;
for (const k of ks) {
  count = count + 1;
}
if (ks.length === 2 && count === 2) {
  console.log("TEST_PASSED");
}
