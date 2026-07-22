class Animal {
  name: string;
  constructor(n: string) {
    this.name = n;
  }
  speak(): string {
    return "...";
  }
  intro(): string {
    return this.name + " says " + this.speak();
  }
}
class Dog extends Animal {
  override speak(): string {
    return "woof";
  }
}
class Cat extends Animal {
  override speak(): string {
    return "meow";
  }
}
const animals: Animal[] = [new Animal("thing"), new Dog("Rex"), new Cat("Felix")];
for (const a of animals) {
  console.log(a.speak());
  console.log(a.intro());
}
console.log(new Dog("Buddy").name);
