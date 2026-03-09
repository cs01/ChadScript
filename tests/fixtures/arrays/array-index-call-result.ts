function getNumbers(): number[] {
  return [10, 20, 30];
}

function getStrings(): string[] {
  return ["hello", "world"];
}

const first = getNumbers()[0];
const second = getNumbers()[1];
const greeting = getStrings()[0];

if (first === 10 && second === 20 && greeting === "hello") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: first=" + first + " second=" + second + " greeting=" + greeting);
}
