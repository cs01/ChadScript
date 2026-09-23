// console.log's util.format directives in a literal first argument, with Node's conversions.
const n = 3;
console.log("%s items", n);
console.log("100%%", n);
console.log("%d|%i|%f", "42.9px", "42.9px", "42.9px");
console.log("%d %d %d %d %d", "", " 12 ", "0x1f", true, null);
console.log("%i %i %f %f", -0, "  -7.5e1", "Infinity", ".5");
console.log("%d %i %f", [5], ["12px", 3], [[" 7"], 3]);
console.log("%d %i %f %d", [], [], [null], { a: 1 });
console.log("%s|%s|%s|%s|%s", "str", -0, false, null, undefined);
console.log("%s", [1, [2, [3]]], { a: { b: 1 } });
const m = new Map<number, { a: number[] }>();
m.set(1, { a: [1] });
console.log("%s and %s", m, new Set(["x"]));
console.log("%j %j %j %j", { a: [1, "x"] }, 'q"s', 1.5, null);
console.log("%j %j %j", NaN, [3, 2], undefined);
console.log("%O and %o", { a: [1, 2] }, { a: [1, 2] });
console.log("%o", [[1, [2, [3, [4, [5]]]]]]);
console.log("%o %o %o", [], "str", 7);
console.log("%o", [1, 2, 3, 4, 5, 6, 7, 8]);
console.log("%c styled %s", "color: red", "text");
console.log("%s %s", "only one");
console.log("%x %s %", 1, 2);
console.log("a%%b%sc", "X", "extra", 4);
console.log("%s", "a", "b", [1]);
console.log("%%", 1);
console.log("%s%s%s", 1, 2, 3, 4);
for (const n of [101, 102, 150]) {
  const big: number[] = [];
  for (let i = 0; i < n; i++) big.push((i * 37) % 1000);
  console.log("%o", big);
}
