class Animal {
  name: string;
  legs: number;
  constructor(n: string, l: number) {
    this.name = n;
    this.legs = l;
  }
  describe(): string {
    return this.name + " has " + this.legs + " legs";
  }
}
class Dog extends Animal {
  breed: string;
  constructor(n: string, b: string) {
    super(n, 4);
    this.breed = b;
  }
  info(): string {
    return this.describe() + " (breed: " + this.breed + ")";
  }
}
const d = new Dog("Rex", "Lab");
console.log(d.name);
console.log(d.legs);
console.log(d.breed);
console.log(d.describe());
console.log(d.info());
const a = new Animal("Generic", 2);
console.log(a.describe());
