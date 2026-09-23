// @known-bug: JSON.stringify of a cyclic object overflows the stack instead of throwing TypeError
interface Node2 {
  name: string;
  next: Node2 | null;
}
const a: Node2 = { name: "a", next: null };
a.next = a;
try {
  JSON.stringify(a);
  console.log("no throw");
} catch (e) {
  console.log(e instanceof TypeError, String(e).slice(0, 40));
}
