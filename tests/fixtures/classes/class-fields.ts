class Person {
  name: string;
  age: number;
  active: boolean;
  constructor(name: string, age: number, active: boolean) {
    this.name = name;
    this.age = age;
    this.active = active;
  }
  greet(): string {
    return "Hello " + this.name;
  }
  isAdult(): boolean {
    return this.age >= 18;
  }
}

let p: Person = new Person("Alice", 30, true);
console.log(p.name);
console.log(p.age);
console.log(p.active);
console.log(p.greet());
console.log(p.isAdult());

let kid: Person = new Person("Bob", 12, false);
console.log(kid.name);
console.log(kid.isAdult());
