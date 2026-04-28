function earlyReturn(x: number): string {
  if (x > 0) {
    return "positive";
    console.log("unreachable");
  }
  return "non-positive";
  console.log("also unreachable");
}

console.log(earlyReturn(5));
console.log(earlyReturn(-1));

function loopBreak(): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    if (i === 5) {
      break;
      sum = 999;
    }
    sum = sum + i;
  }
  return sum;
}

console.log(loopBreak());

function loopContinue(): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    if (i % 2 === 0) {
      continue;
      sum = sum + 100;
    }
    sum = sum + i;
  }
  return sum;
}

console.log(loopContinue());
