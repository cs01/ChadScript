// A class's vtable ADDRESS is its runtime identity — `instanceof` compares vtable pointers. A
// method-less class used to emit a zero-length vtable, and two zero-sized objects can share an
// address, so a base instance tested true against a method-less sibling (on GNU ld, not macOS).
class Base {
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
}
// Neither subclass declares a method, so both vtables are empty AND identical in content.
class Left extends Base {}
class Right extends Base {}

const items: Base[] = [new Base("base"), new Left("left"), new Right("right")];
for (const item of items) {
  if (item instanceof Left) {
    console.log("Left:", item.tag);
  } else if (item instanceof Right) {
    console.log("Right:", item.tag);
  } else {
    console.log("Base:", item.tag);
  }
}
console.log(new Base("b") instanceof Left, new Left("l") instanceof Right);
