class Animal {
  name: string;
  constructor(n: string) {
    this.name = n;
  }
}
class Dog extends Animal {
  bark(): string {
    return "woof";
  }
}
class Cat extends Animal {}
const a: Animal = new Dog("Rex");
console.log(a instanceof Dog);
console.log(a instanceof Cat);
console.log(a instanceof Animal);
const c: Animal = new Cat("Felix");
console.log(c instanceof Dog);
console.log(c instanceof Animal);
const animals: Animal[] = [new Dog("d"), new Cat("c"), new Animal("a")];
for (const x of animals) {
  if (x instanceof Dog) {
    console.log("dog: " + x.name);
  } else if (x instanceof Cat) {
    console.log("cat: " + x.name);
  } else {
    console.log("animal: " + x.name);
  }
}
