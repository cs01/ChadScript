function greet(name: string, greeting: string = "Hello"): string {
  return greeting + ", " + name;
}

function testDefaultParams(): void {
  const r1: string = greet("Alice", "Hi");
  if (r1 !== "Hi, Alice") {
    console.log("FAIL: explicit param got " + r1);
    process.exit(1);
  }

  const r2: string = greet("Bob");
  if (r2 !== "Hello, Bob") {
    console.log("FAIL: default param got " + r2);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testDefaultParams();
