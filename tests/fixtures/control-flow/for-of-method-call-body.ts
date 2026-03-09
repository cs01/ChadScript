interface Animal {
  name: string;
  sound: string;
}

class Zoo {
  animals: Animal[] = [];

  add(name: string, sound: string): void {
    this.animals.push({ name: name, sound: sound });
  }

  describe(a: Animal): string {
    return a.name + " says " + a.sound;
  }

  describeAll(): string {
    let result = "";
    for (const animal of this.animals) {
      result = result + this.describe(animal) + "; ";
    }
    return result;
  }
}

const zoo = new Zoo();
zoo.add("cat", "meow");
zoo.add("dog", "woof");

const desc = zoo.describeAll();
if (desc === "cat says meow; dog says woof; ") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: got '" + desc + "'");
}
