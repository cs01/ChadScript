interface Animal {
  name: string;
  speak(): string;
}
class Dog implements Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  speak(): string {
    return this.name + " woof";
  }
}
const a: Animal[] = [new Dog("rex"), { name: "cat", speak: () => "meow" }];
for (const x of a) console.log(x.speak());
