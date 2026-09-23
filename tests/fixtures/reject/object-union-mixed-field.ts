// @expect-reject: CS1233
// The members share `id`, but as a number in one and a string in the other: reading `r.id`
// through the union has no single representation until phase 4's Value unions.
type R = { tag: "a"; id: number } | { tag: "b"; id: string };
function f(r: R): string {
  return r.tag;
}
console.log(f({ tag: "a", id: 1 }), f({ tag: "b", id: "x" }));
