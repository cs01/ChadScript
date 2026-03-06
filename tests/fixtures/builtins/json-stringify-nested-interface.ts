// @test-description: json stringify nested interface fields

interface Address {
  street: string;
  zip: string;
}

interface Person {
  name: string;
  age: number;
  address: Address;
}

const addr: Address = { street: "123 Main St", zip: "90210" };
const person: Person = { name: "Alice", age: 30, address: addr };

const json = JSON.stringify(person);
const parsed = JSON.parse<Person>(json);

if (parsed.name === "Alice" && parsed.age === 30) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL");
}
