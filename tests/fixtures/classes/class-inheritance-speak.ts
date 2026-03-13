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
  breed: string;
  constructor(name: string, breed: string) {
    super(name);
    this.breed = breed;
  }
  speak(): string {
    return this.name + " barks";
  }
  info(): string {
    return this.name + " is a " + this.breed;
  }
}

const d = new Dog("Rex", "Shepherd");
if (d.speak() !== "Rex barks") process.exit(1);
if (d.info() !== "Rex is a Shepherd") process.exit(1);
if (d.name !== "Rex") process.exit(1);

const a = new Animal("Cat");
if (a.speak() !== "Cat makes a sound") process.exit(1);

console.log("TEST_PASSED");
