// @test-description: functions can return and call function values
function makeAdder(x: number): (y: number) => number {
  return (y: number): number => x + y;
}

function makeGreeter(prefix: string): (name: string) => string {
  return (name: string): string => prefix + " " + name;
}

function main(): void {
  const add5 = makeAdder(5);
  const result = add5(3);
  if (result !== 8) {
    console.log("FAIL: expected 8, got " + result.toString());
    process.exit(1);
  }

  const greet = makeGreeter("Hello");
  const msg = greet("world");
  if (msg !== "Hello world") {
    console.log("FAIL: expected 'Hello world', got '" + msg + "'");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

main();
