const a: number[] = [1, 2, 3];
a.splice(100, 1);
if (a.length !== 3) throw new Error("splice past end should be no-op, got length " + a.length);
if (a[0] !== 1) throw new Error("a[0]");
if (a[1] !== 2) throw new Error("a[1]");
if (a[2] !== 3) throw new Error("a[2]");

const b: string[] = ["x", "y", "z"];
b.splice(50, 2);
if (b.length !== 3)
  throw new Error("string splice past end should be no-op, got length " + b.length);

const c: number[] = [10, 20, 30];
c.splice(3, 0);
if (c.length !== 3) throw new Error("splice at exact end should be no-op");

const d: number[] = [1, 2, 3];
c.splice(-100, 1);
if (c.length !== 2) throw new Error("splice with very negative start should remove from index 0");

console.log("TEST_PASSED");
