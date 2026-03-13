class Animal {
  name: string;
  legs: number;

  constructor(name: string, legs: number) {
    this.name = name;
    this.legs = legs;
  }

  describe(): string {
    return this.name + " has " + this.legs.toString() + " legs";
  }
}

class Dog extends Animal {
  breed: string;

  constructor(name: string, breed: string) {
    super(name, 4);
    this.breed = breed;
  }

  bark(): string {
    return this.name + " says woof";
  }
}

const d = new Dog("Rex", "Lab");
if (d.name !== "Rex") {
  process.exit(1);
}
if (d.legs !== 4) {
  process.exit(1);
}
if (d.breed !== "Lab") {
  process.exit(1);
}

const desc = d.describe();
if (desc !== "Rex has 4 legs") {
  process.exit(1);
}

const bk = d.bark();
if (bk !== "Rex says woof") {
  process.exit(1);
}

const a = new Animal("Cat", 4);
if (a.describe() !== "Cat has 4 legs") {
  process.exit(1);
}

console.log("TEST_PASSED");
