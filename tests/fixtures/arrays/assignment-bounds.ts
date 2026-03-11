// @test-exit-code: 1
function test(): void {
  const arr: number[] = [1, 2, 3];
  arr[0] = 10;
  if (arr[0] !== 10) {
    console.log("FAIL basic assignment");
    return;
  }
  arr[2] = 30;
  if (arr[2] !== 30) {
    console.log("FAIL index 2 assignment");
    return;
  }
  arr[5] = 99;
  console.log("FAIL should have crashed on out-of-bounds write");
}
test();
