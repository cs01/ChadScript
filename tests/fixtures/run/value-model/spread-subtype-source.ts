// A spread copies the source's RUNTIME fields, in its order, so the result layout depends on the
// shape of whatever arrived. Also: reads through an inline cache that sees several shapes, a field
// absent from some shapes reading as undefined, and a spread source changed by a later initializer.
const src = { n: 1, m: 2 };
interface Named {
  name: string;
}
interface Tagged {
  name: string;
  tag?: string;
}
function clone(n: Named): Named {
  return { ...n };
}
function withTag(n: Named, tag: string): Tagged {
  return { ...n, tag };
}
const a = { id: 1, name: "a" };
const b = { name: "b", extra: true, id: 2 };
const items: Named[] = [a, b, { name: "c" }, clone(a), withTag(b, "t")];
for (const it of items) console.log(it, clone(it));
const tagged: Tagged[] = [withTag(a, "x"), { name: "plain" }, { tag: "first", name: "y" }];
for (const t of tagged) console.log(t.name, t.tag ?? "(none)");
function bump(): number {
  src.n = 100;
  return 7;
}
const snap = { ...src, k: bump() };
console.log(snap, src);
