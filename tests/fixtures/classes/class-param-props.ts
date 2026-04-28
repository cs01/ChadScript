class Point {
  constructor(public x: number, public y: number) {}
}

const p = new Point(3, 4);
console.log(p.x);
console.log(p.y);

class Person {
  constructor(public name: string, public age: number) {
    console.log("created");
  }
}

const bob = new Person("Bob", 25);
console.log(bob.name);
console.log(bob.age);
