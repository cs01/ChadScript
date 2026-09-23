// @expect-reject: CS1238
// The literal holding a caught value reaches `Named`, so JSON.stringify of a Named can serialize it.
interface Named {
  n: number;
}
function show(x: Named): void {
  console.log(JSON.stringify(x));
}
show({ n: 2 });
try {
  throw new Error("x");
} catch (e) {
  const h = { n: 1, e };
  show(h);
}
