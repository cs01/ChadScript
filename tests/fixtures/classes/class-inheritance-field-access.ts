class Animal {
  name: string;
  legs: number;
  constructor(name: string, legs: number) {
    this.name = name;
    this.legs = legs;
  }
}

class Dog extends Animal {
  breed: string;
  constructor(name: string, breed: string) {
    super(name, 4);
    this.breed = breed;
  }
}

function main(): void {
  const dog = new Dog("Rex", "Labrador");
  if (dog.name === "Rex" && dog.legs === 4 && dog.breed === "Labrador") {
    console.log("TEST_PASSED");
  }
}

main();
