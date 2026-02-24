// @test-description: computed property write via dynamic key
const obj = { name: "alice", age: 30 };
const key = "name";
obj[key] = "bob";
if (obj.name === "bob" && obj.age === 30) {
  console.log("TEST_PASSED");
}
