// Constrained type parameters: member access on T goes through the object's runtime shape, so
// classes and literals with the field at different slots all work.
interface Named {
  name: string;
}

function greet<T extends Named>(x: T): string {
  return `hi ${x.name}`;
}

class Dog {
  age: number;
  name: string;
  constructor(name: string, age: number) {
    this.name = name;
    this.age = age;
  }
}

function oldest<T extends { age: number }>(xs: T[]): T | undefined {
  let best: T | undefined = undefined;
  for (const x of xs) {
    if (best === undefined || x.age > best.age) best = x;
  }
  return best;
}

function names<T extends Named>(xs: T[]): string[] {
  return xs.map((x) => x.name);
}

const rex = new Dog("rex", 3);
const fido = new Dog("fido", 7);
console.log(greet(rex), greet({ name: "lit" }), greet({ tag: 1, name: "wide" }));
const dogs: Dog[] = [rex, fido];
const o = oldest(dogs);
if (o !== undefined) console.log(o.name, o.age);
const people = [
  { name: "ann", age: 30 },
  { name: "bob", age: 40 },
];
const op = oldest(people);
if (op !== undefined) console.log(op.name);
console.log(names(dogs).join(","), names(people).join(","));
