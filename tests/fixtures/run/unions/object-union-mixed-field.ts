// Was a CS1233 rejection: the members share `id`, as a number in one and a string in the
// other, so the union's common field is itself a Value union (object fields already hold Values).
type R = { tag: "a"; id: number } | { tag: "b"; id: string };
function f(r: R): string {
  return r.tag;
}
console.log(f({ tag: "a", id: 1 }), f({ tag: "b", id: "x" }));
