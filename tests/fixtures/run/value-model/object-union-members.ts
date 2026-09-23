// A union of object types is one object type over the members' common fields; reads through it
// and through each narrowed member follow the objects' own layouts.
type Ev =
  | { kind: "click"; x: number; y: number }
  | { kind: "key"; code: string }
  | { at: number; kind: "tick" };
function show(e: Ev): string {
  switch (e.kind) {
    case "click":
      return `click ${e.x},${e.y}`;
    case "key":
      return `key ${e.code}`;
    case "tick":
      return `tick@${e.at}`;
  }
}
const evs: Ev[] = [
  { kind: "click", x: 1, y: 2 },
  { kind: "key", code: "Enter" },
  { at: 9, kind: "tick" },
];
for (const e of evs) console.log(e.kind, show(e), e);

class Cat {
  name = "tom";
  speak(): string {
    return this.name + " meows";
  }
}
class Dog {
  name = "rex";
  legs = 4;
  speak(): string {
    return this.name + " barks";
  }
}
const pets: (Cat | Dog)[] = [new Cat(), new Dog()];
for (const p of pets) {
  console.log(p.name, p.speak(), p instanceof Dog ? p.legs : 0);
}
