const a: number[] = [1, 2, 3, 4, 5];
a.splice(0, 0);
if (a.length !== 5) throw new Error("array unchanged after splice 0,0");

const c: number[] = [1, 2, 3];
c.splice(0, 100);
if (c.length !== 0) throw new Error("array empty after splice all");

const e: number[] = [];
e.splice(0, 0);
if (e.length !== 0) throw new Error("empty after splice");

const f: number[] = [10, 20, 30, 40, 50];
f.splice(2, 2);
if (f.length !== 3) throw new Error("splice middle: " + f.length);
if (f[0] !== 10) throw new Error("f[0]");
if (f[1] !== 20) throw new Error("f[1]");
if (f[2] !== 50) throw new Error("f[2]");

const g: number[] = [1, 2, 3];
g.splice(1, 1);
if (g.length !== 2) throw new Error("splice single: " + g.length);
if (g[0] !== 1) throw new Error("g[0]");
if (g[1] !== 3) throw new Error("g[1]");

console.log("TEST_PASSED");
