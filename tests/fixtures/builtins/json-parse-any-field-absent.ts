// @test expectTestPassed
// Regression for #631: absent `any`-typed field must be an empty string, not
// a null pointer. Prior behavior: string ops (===, concat) on an absent any
// field segfaulted because the slot was left as a raw null pointer. Fix:
// pre-init any/unknown slots to "" during struct allocation, same as
// string fields.
interface E {
  seq: number;
  body: any;
}
const e = JSON.parse<E>('{"seq":1}');
let ok = e.seq === 1;
// These all segfaulted prior to the fix when body was absent:
ok = ok && e.body === "";
ok = ok && e.body !== "null";
ok = ok && "body=[" + e.body + "]" === "body=[]";

const e2 = JSON.parse<E>('{"seq":2,"body":{"x":7}}');
ok = ok && e2.seq === 2;
ok = ok && e2.body !== "";
if (ok) console.log("TEST_PASSED");
