interface Animal {
  name: string;
  age: number;
}

interface Dog extends Animal {
  breed: string;
}

function describeAnimal(a: Animal): string {
  return a.name;
}

function describeDog(d: Dog): string {
  return d.name + "-" + d.breed;
}

const d: Dog = { name: "Rex", age: 3, breed: "Labrador" };

const n = describeAnimal(d);
const s = describeDog(d);

if (n === "Rex" && s === "Rex-Labrador" && d.age === 3) {
  console.log("TEST_PASSED");
}
