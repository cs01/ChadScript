// Value unions as object and class fields, narrowed through property reads; instanceof and
// Array.isArray on a union; discriminants; `??` and `||` producing unions.
interface Item {
  id: number | string;
  tag?: string | number;
  data: boolean | number[] | null;
}

class Box {
  label: string | number;
  constructor(label: string | number) {
    this.label = label;
  }
  describe(): string {
    return typeof this.label === "number" ? `#${this.label + 1}` : `box ${this.label}`;
  }
}

class Crate extends Box {
  weight = 3;
}

const items: Item[] = [
  { id: 1, data: true },
  { id: "b", tag: "t", data: [1, 2] },
  { id: 3, tag: 9, data: null },
];
for (const it of items) {
  const idText = typeof it.id === "string" ? it.id.toUpperCase() : (it.id * 100).toString();
  let dataText = "none";
  if (Array.isArray(it.data)) dataText = `arr ${it.data.length}`;
  else if (it.data !== null) dataText = it.data ? "yes" : "no";
  console.log(idText, dataText, it.tag ?? "untagged", it.tag || 0, it);
}
console.log(JSON.stringify(items));
const i0 = items[0];
const i1 = items[1];
if (i0 !== undefined && i1 !== undefined) {
  i0.id = "renamed";
  i1.id = 42;
  console.log(i0, i1, JSON.stringify(i1));
}

const things: (Box | string | number)[] = [new Box("x"), new Crate(7), "plain", 12];
for (const t of things) {
  if (t instanceof Crate) console.log("crate", t.weight, t.describe());
  else if (t instanceof Box) console.log("box", t.describe());
  else if (typeof t === "string") console.log("string", t.length);
  else console.log("number", t + 1);
}
console.log(things);

type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number } | string;
function area(s: Shape): string {
  if (typeof s === "string") return `named ${s}`;
  switch (s.kind) {
    case "circle":
      return `circle ${s.r * s.r * 3}`;
    case "square":
      return `square ${s.side * s.side}`;
  }
}
const shapes: Shape[] = [{ kind: "circle", r: 2 }, "blob", { kind: "square", side: 3 }];
console.log(shapes.map(area));

function firstPresent(a: string | undefined, b: number | undefined): string | number {
  return a ?? b ?? "neither";
}
console.log(firstPresent("a", 1), firstPresent(undefined, 2), firstPresent(undefined, undefined));
function orFallback(v: string | number): string | number {
  return v || "fallback";
}
console.log(orFallback(0), orFallback(""), orFallback("x"), orFallback(5));
const flag: boolean | string = items.length > 2 && "long";
console.log(flag, typeof flag);
