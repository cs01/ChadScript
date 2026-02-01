const p1 = Promise.resolve("first");
const p2 = Promise.resolve("second");
const p3 = Promise.resolve("third");

const promises: any[] = [p1, p2, p3];
const allPromise = Promise.all(promises);

allPromise.then((results) => {
  console.log("Promise.all resolved!");
  console.log("TEST_PASSED");
});

console.log("after all");
