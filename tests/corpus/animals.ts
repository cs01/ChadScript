// @category: oop
// The textbook class example, written the usual way: an abstract Animal, subclasses overriding
// methods, super calls, a static registry, and polymorphic dispatch over a mixed array.

abstract class Animal {
  static count = 0;
  protected energy = 10;

  constructor(
    readonly name: string,
    readonly legs: number,
  ) {
    Animal.count++;
  }

  abstract sound(): string;

  speak(): string {
    return `${this.name} says ${this.sound()}`;
  }

  move(distance: number): string {
    this.energy -= distance;
    return `${this.name} moved ${distance}m (energy ${this.energy})`;
  }

  get tired(): boolean {
    return this.energy <= 0;
  }
}

class Dog extends Animal {
  constructor(
    name: string,
    private tricks: string[] = [],
  ) {
    super(name, 4);
  }
  sound(): string {
    return "woof";
  }
  learn(trick: string): this {
    this.tricks.push(trick);
    return this;
  }
  perform(): string {
    return this.tricks.length
      ? `${this.name} can ${this.tricks.join(" and ")}`
      : `${this.name} knows no tricks`;
  }
}

class Bird extends Animal {
  constructor(
    name: string,
    readonly canFly: boolean,
  ) {
    super(name, 2);
  }
  sound(): string {
    return "tweet";
  }
  override move(distance: number): string {
    if (!this.canFly) return super.move(distance);
    this.energy -= distance / 4;
    return `${this.name} flew ${distance}m (energy ${this.energy})`;
  }
}

class Cat extends Animal {
  constructor(name: string) {
    super(name, 4);
  }
  sound(): string {
    return this.tired ? "zzz" : "meow";
  }
}

const zoo: Animal[] = [
  new Dog("Rex").learn("sit").learn("roll over"),
  new Bird("Tweety", true),
  new Bird("Pingu", false),
  new Cat("Tom"),
];
for (const a of zoo) {
  console.log(a.speak());
  console.log("  " + a.move(8));
  console.log("  " + a.move(4));
}
for (const a of zoo) {
  if (a instanceof Dog) console.log(a.perform());
  else if (a instanceof Bird) console.log(`${a.name} ${a.canFly ? "can" : "cannot"} fly`);
}
console.log(`animals created: ${Animal.count}`);
console.log(`total legs: ${zoo.reduce((n, a) => n + a.legs, 0)}`);
console.log(
  `tired: ${zoo
    .filter((a) => a.tired)
    .map((a) => a.name)
    .join(", ")}`,
);
console.log(zoo.map((a) => a.constructor.name).join(" "));
