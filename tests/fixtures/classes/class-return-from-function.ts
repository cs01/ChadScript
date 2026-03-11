// @test-description: class instance returned from function has correct field access

class Animal {
  name: string;
  legs: number;
  constructor(n: string, l: number) {
    this.name = n;
    this.legs = l;
  }
}

function createAnimal(n: string, l: number): Animal {
  return new Animal(n, l);
}

const cat = createAnimal("cat", 4);
console.log(cat.name);
console.log(cat.legs.toString());

function test(): void {
  const dog = createAnimal("dog", 4);
  if (dog.name !== "dog") {
    console.log("FAIL: local name");
    process.exit(1);
  }
  if (dog.legs !== 4) {
    console.log("FAIL: local legs");
    process.exit(1);
  }
  console.log("TEST_PASSED");
}
test();
