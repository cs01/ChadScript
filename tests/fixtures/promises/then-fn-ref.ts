function handleValue(value: string): void {
  console.log("Got value:");
  console.log(value);
}

const p = Promise.resolve("test data");
p.then(handleValue);
console.log("after then");
