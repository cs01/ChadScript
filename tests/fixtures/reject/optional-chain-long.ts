// @expect-reject: CS1000
// Only a single `x?.f` link is admitted; a longer chain short-circuits several accesses at once.
interface In {
  v: number;
}
interface Out {
  inner: In;
}
const m = new Map<string, Out>();
m.set("a", { inner: { v: 1 } });
console.log(m.get("a")?.inner.v ?? -1);
