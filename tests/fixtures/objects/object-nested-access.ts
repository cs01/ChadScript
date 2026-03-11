interface Address {
  city: string;
  zip: string;
}

interface Person {
  name: string;
  address: Address;
}

function getCity(p: Person): string {
  return p.address.city;
}

const addr: Address = { city: "NYC", zip: "10001" };
const person: Person = { name: "Alice", address: addr };

let passed = true;
if (person.name !== "Alice") passed = false;
if (person.address.city !== "NYC") passed = false;
if (getCity(person) !== "NYC") passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
