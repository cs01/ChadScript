// @test-exit-code: 0
// Tests do...while loop: body executes at least once, then checks condition

let count = 0;
do {
  count = count + 1;
} while (count < 5);

// count should be 5
if (count !== 5) {
  process.exit(1);
}

// do...while always runs body at least once, even if condition is false
let ran = 0;
do {
  ran = 1;
} while (false);

if (ran !== 1) {
  process.exit(2);
}

// break inside do...while
let breakCount = 0;
do {
  breakCount = breakCount + 1;
  if (breakCount === 3) {
    break;
  }
} while (breakCount < 10);

if (breakCount !== 3) {
  process.exit(3);
}

// continue inside do...while (should jump to condition check)
let sum = 0;
let i = 0;
do {
  i = i + 1;
  if (i === 3) {
    continue;
  }
  sum = sum + i;
} while (i < 5);

// sum = 1 + 2 + 4 + 5 = 12 (skipped 3)
if (sum !== 12) {
  process.exit(4);
}

console.log("TEST_PASSED");
