function makeCounter(): () => number {
  let count: number = 0;
  function increment(): number {
    count = count + 1;
    return count;
  }
  return increment;
}

const counter = makeCounter();
console.log(counter());
console.log(counter());
console.log(counter());

function makeAdder(x: number): (y: number) => number {
  function add(y: number): number {
    return x + y;
  }
  return add;
}

const add5 = makeAdder(5);
const add10 = makeAdder(10);
console.log(add5(3));
console.log(add10(3));
console.log("TEST_PASSED");
