// @test-description: bounds-check elimination bails when loop body mutates the array
// The pop() shrinks arr mid-iteration; without the bounds check, subsequent
// accesses would read past the new end.  We explicitly compare arr.length each
// iteration since pop shortens the array.
const arr: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
let total = 0;
let i = 0;
while (i < arr.length) {
  total = total + arr[i];
  arr.pop();
  i = i + 1;
}

// i=0: arr=[1..8], read 1, pop -> [1..7]
// i=1: arr=[1..7], read 2, pop -> [1..6]
// i=2: arr=[1..6], read 3, pop -> [1..5]
// i=3: arr=[1..5], read 4, pop -> [1..4]
// i=4: arr=[1..4], 4 < 4 false, stop.
// total = 1 + 2 + 3 + 4 = 10
if (total === 10) {
  console.log("TEST_PASSED");
}
