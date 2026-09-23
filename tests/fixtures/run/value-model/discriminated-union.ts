// @known-bug: phase 4 (Value + narrowing): lowering ICEs on a union of object literals
type Shape = { kind: "c"; r: number } | { kind: "s"; w: number };
function area(s: Shape): number {
  switch (s.kind) {
    case "c":
      return 3 * s.r * s.r;
    case "s":
      return s.w * s.w;
  }
}
console.log(area({ kind: "s", w: 2 }), area({ kind: "c", r: 1 }));
