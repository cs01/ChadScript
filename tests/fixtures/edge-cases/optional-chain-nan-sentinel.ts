interface C {
  val: number;
}
interface B {
  c?: C;
}
interface A {
  b?: B;
}
const a2: A = {};
const r = a2?.b?.c?.val ?? -1;
if (r === -1) console.log("TEST_PASSED");
else console.log("TEST_FAILED got " + r);
