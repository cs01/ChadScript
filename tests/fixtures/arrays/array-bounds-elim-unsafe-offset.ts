// @test-exit-code: 1
// @test-description: bounds-check is NOT elided for offset indices
// Even though `i < arr.length`, `arr[i + 5]` is NOT proven in-bounds,
// so the bounds check must still fire at runtime.
const arr: number[] = [1, 2, 3];
let i = 0;
while (i < arr.length) {
  const v = arr[i + 5];
  console.log(v);
  i = i + 1;
}
