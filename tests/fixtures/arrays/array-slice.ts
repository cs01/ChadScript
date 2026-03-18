function testArraySlice(): void {
  const arr: number[] = [1, 2, 3, 4, 5];

  const sliced = arr.slice(1, 3);
  if (sliced.length !== 2) {
    throw new Error("slice(1,3) length should be 2");
  }
  if (sliced[0] !== 2) {
    throw new Error("slice(1,3)[0] should be 2");
  }
  if (sliced[1] !== 3) {
    throw new Error("slice(1,3)[1] should be 3");
  }

  const allCopy = arr.slice(0);
  if (allCopy.length !== 5) {
    throw new Error("slice(0) should copy all 5 elements");
  }

  console.log("TEST_PASSED");
}

testArraySlice();
