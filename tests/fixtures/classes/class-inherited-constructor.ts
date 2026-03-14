class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  speak(): string {
    return this.name + " makes a sound";
  }
}

class Dog extends Animal {
  speak(): string {
    return this.name + " barks";
  }
}

class Cat extends Animal {
  speak(): string {
    return this.name + " meows";
  }
}

class Base {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
}

class Child extends Base {
  double(): number {
    return this.value * 2;
  }
}

const d: Dog = new Dog("Rex");
const c: Cat = new Cat("Whiskers");
const a: Animal = new Animal("Generic");
const ch: Child = new Child(5);

let pass: boolean = true;
if (d.speak() !== "Rex barks") {
  console.log("FAIL dog: " + d.speak());
  pass = false;
}
if (c.speak() !== "Whiskers meows") {
  console.log("FAIL cat: " + c.speak());
  pass = false;
}
if (a.speak() !== "Generic makes a sound") {
  console.log("FAIL animal: " + a.speak());
  pass = false;
}
if (ch.double() !== 10) {
  console.log("FAIL child: " + ch.double().toString());
  pass = false;
}
if (pass) {
  console.log("TEST_PASSED");
}
