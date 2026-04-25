class Animal {
  name: string = "dog";
  legs: number = 4;
}

function testClosureClassCapture(): void {
  const a = new Animal();
  const items: string[] = ["x"];
  items.forEach(() => {
    if (a.name !== "dog") {
      console.log("FAIL: expected dog, got " + a.name);
      process.exit(1);
    }
    if (a.legs !== 4) {
      console.log("FAIL: expected 4 legs");
      process.exit(1);
    }
  });
  console.log("TEST_PASSED");
}

testClosureClassCapture();
