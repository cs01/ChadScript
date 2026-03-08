interface Animal {
  name: string;
  age: number;
}

interface Dog extends Animal {
  breed: string;
}

function testForOfInheritedFields(): void {
  const dogs: Dog[] = [
    { name: "Rex", age: 3, breed: "Labrador" },
    { name: "Buddy", age: 5, breed: "Poodle" },
  ];

  let names = "";
  for (const dog of dogs) {
    names = names + dog.name + ",";
  }
  if (names !== "Rex,Buddy,") {
    console.log("FAIL: names=" + names);
    process.exit(1);
  }
  console.log("TEST_PASSED");
}

testForOfInheritedFields();
