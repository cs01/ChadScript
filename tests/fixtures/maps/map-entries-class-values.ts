class Person {
  name: string;
  age: number;
  constructor(name: string, age: number) {
    this.name = name;
    this.age = age;
  }
}

const m = new Map<string, Person>();
m.set("alice", new Person("Alice", 30));
m.set("bob", new Person("Bob", 25));

let nameSum = "";
for (const [k, v] of m.entries()) {
  nameSum = nameSum + v.name + ",";
}

if (nameSum === "Alice,Bob,") {
  console.log("TEST_PASSED");
}
