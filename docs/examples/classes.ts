// Classes with inheritance, super calls, overrides and instanceof; an interface implemented by
// a class and satisfied by a plain object literal, called through the interface.
interface Named {
  name: string;
  greet(): string;
}

class Animal implements Named {
  name: string;
  legs: number;
  constructor(name: string, legs: number) {
    this.name = name;
    this.legs = legs;
  }
  greet(): string {
    return `${this.name} has ${this.legs} legs`;
  }
}

class Bird extends Animal {
  canFly: boolean;
  constructor(name: string, canFly: boolean) {
    super(name, 2);
    this.canFly = canFly;
  }
  override greet(): string {
    return super.greet() + (this.canFly ? " and flies" : " and walks");
  }
}

const robot: Named = {
  name: "unit-7",
  greet: (): string => "beep",
};

const all: Named[] = [new Animal("cat", 4), new Bird("penguin", false), robot];
for (const n of all) {
  console.log(n.greet(), n instanceof Bird);
}
