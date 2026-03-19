interface Person {
  name: string;
  age: number;
  active: boolean;
}

const input = "name: Alice\nage: 30\nactive: true";
const result: Person = YAML.parse<Person>(input);
if (result.name === "Alice" && result.age === 30 && result.active === true) {
  console.log("TEST_PASSED");
}
