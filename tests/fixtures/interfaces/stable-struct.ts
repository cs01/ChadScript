interface Person {
  name: string;
  age: number;
  city: string;
}

function getPerson(): Person {
  const p: Person = { age: 30, city: "NYC", name: "Alice" };
  return p;
}

function showPerson(p: Person): number {
  console.log(p.name);
  console.log(p.age);
  console.log(p.city);
  return 0;
}

const person1: Person = { name: "Bob", age: 25, city: "LA" };
showPerson(person1);

const person2 = getPerson();
showPerson(person2);
