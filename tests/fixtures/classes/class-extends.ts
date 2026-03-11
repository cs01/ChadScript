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
}

function testClassExtends(): void {
  const dog = new Dog("Rex", "Labrador");

  if (dog.name !== "Rex") {
    console.log("FAIL: name should be Rex, got " + dog.name);
    process.exit(1);
  }

  if (dog.breed !== "Labrador") {
    console.log("FAIL: breed should be Labrador, got " + dog.breed);
    process.exit(1);
  }

  const sound: string = dog.speak();
  if (sound !== "Rex barks") {
    console.log("FAIL: speak should be 'Rex barks', got " + sound);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testClassExtends();
