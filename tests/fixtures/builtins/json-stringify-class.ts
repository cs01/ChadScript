// @test-description: json stringify class instance with string, number, boolean fields
class User {
  name: string;
  age: number;
  active: boolean;
  constructor(name: string, age: number, active: boolean) {
    this.name = name;
    this.age = age;
    this.active = active;
  }
}

function test() {
  const u = new User("chad", 30, true);
  const result = JSON.stringify(u);
  if (result === '{"name":"chad","age":30,"active":true}') {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: " + result);
  }
}
test();
