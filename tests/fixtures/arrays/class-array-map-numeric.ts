class Person {
  name: string;
  age: number;
  constructor(name: string, age: number) {
    this.name = name;
    this.age = age;
  }
}

const people: Person[] = [
  new Person("alice", 30),
  new Person("bob", 25),
  new Person("charlie", 35),
];
const ages = people.map((p: Person): number => p.age);
const names = people.map((p: Person): string => p.name);

if (ages[0] === 30 && ages[1] === 25 && ages[2] === 35) {
  if (names[0] === "alice" && names[1] === "bob" && names[2] === "charlie") {
    if (ages.length === 3 && names.length === 3) {
      console.log("TEST_PASSED");
    }
  }
}
