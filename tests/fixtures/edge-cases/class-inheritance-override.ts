class Animal {
  name: string;
  constructor(name: string) { this.name = name; }
  speak(): string { return this.name + " makes a sound"; }
}
class Dog extends Animal {
  constructor(name: string) { super(name); }
  speak(): string { return this.name + " barks"; }
}
class Cat extends Animal {
  constructor(name: string) { super(name); }
  speak(): string { return this.name + " meows"; }
}
const d = new Dog("Rex");
const c = new Cat("Whiskers");
if (d.speak() !== "Rex barks") process.exit(1);
if (c.speak() !== "Whiskers meows") process.exit(1);
if (d.name !== "Rex") process.exit(1);
if (c.name !== "Whiskers") process.exit(1);

console.log("TEST_PASSED");
