class Animal {
  name: string;
  legs: number;
  constructor(name: string, legs: number) {
    this.name = name;
    this.legs = legs;
  }
  describe(): string {
    return this.name + " has " + this.legs + " legs";
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

class Cat extends Animal {
  indoor: boolean;
  constructor(name: string, indoor: boolean) {
    super(name, 4);
    this.indoor = indoor;
  }
  describe(): string {
    return this.name + " is a cat";
  }
}

let dog: Dog = new Dog("Rex", "Labrador");
console.log(dog.name);
console.log(dog.legs);
console.log(dog.breed);
console.log(dog.describe());
console.log(dog.bark());

let cat: Cat = new Cat("Whiskers", true);
console.log(cat.name);
console.log(cat.describe());
console.log(cat.indoor);
