// JSON.stringify of a cyclic value throws Node's TypeError, with V8's description of the path: the
// first two links after the repeated object, `...`, and the last link; `index N` through arrays;
// the class name as the constructor. A shared (acyclic) object is not a cycle.
interface Link {
  name: string;
  next: Link | null;
}
interface Bag {
  label: string;
  items: Bag[];
}
class Owner {
  pet: Pet | null = null;
}
class Pet {
  owner: Owner | null = null;
}

function show(f: () => string): void {
  try {
    console.log(f());
  } catch (e) {
    if (e instanceof TypeError) console.log(e.name, JSON.stringify(e.message));
    else console.log("other", String(e));
  }
}

const self: Link = { name: "self", next: null };
self.next = self;
show((): string => JSON.stringify(self));

const n5: Link = { name: "n5", next: null };
const n4: Link = { name: "n4", next: n5 };
const n3: Link = { name: "n3", next: n4 };
const n2: Link = { name: "n2", next: n3 };
const n1: Link = { name: "n1", next: n2 };
const n0: Link = { name: "n0", next: n1 };
show((): string => JSON.stringify(n0));
n5.next = n1;
show((): string => JSON.stringify(n0));
n5.next = n2;
show((): string => JSON.stringify(n0, null, 2));
n5.next = n4;
show((): string => JSON.stringify(n0));

const bag: Bag = { label: "outer", items: [] };
const inner: Bag = { label: "inner", items: [] };
bag.items.push({ label: "leaf", items: [] }, inner);
show((): string => JSON.stringify(bag));
inner.items.push(bag);
show((): string => JSON.stringify(bag));
show((): string => JSON.stringify([bag]));

const o = new Owner();
const p = new Pet();
o.pet = p;
p.owner = o;
show((): string => JSON.stringify(o));

// The same object twice, side by side, is not a cycle.
const shared: Link = { name: "shared", next: null };
const twice: Link[] = [shared, shared];
show((): string => JSON.stringify(twice));
show((): string => JSON.stringify({ a: shared, b: shared }));
