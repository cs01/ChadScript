const nums: number[] = [10, 20, 30, 40, 50];
const strs: string[] = ["a", "b", "c", "d", "e"];

const filteredNums = nums.filter((val: number, idx: number): boolean => {
  return idx >= 2;
});
if (filteredNums.length === 3) {
  console.log("num filter index: ok");
} else {
  console.log("FAIL num filter: " + filteredNums.length.toString());
}

const filteredStrs = strs.filter((val: string, idx: number): boolean => {
  return idx < 3;
});
if (filteredStrs.length === 3) {
  console.log("str filter index: ok");
} else {
  console.log("FAIL str filter: " + filteredStrs.length.toString());
}

const mapped = nums.map((val: number, idx: number): number => {
  return val + idx;
});
if (mapped[0] === 10 && mapped[1] === 21 && mapped[2] === 32) {
  console.log("num map index: ok");
} else {
  console.log("FAIL num map");
}

const strMapped = strs.map((val: string, idx: number): string => {
  return val + idx.toString();
});
if (strMapped[0] === "a0" && strMapped[2] === "c2") {
  console.log("str map index: ok");
} else {
  console.log("FAIL str map");
}

console.log("TEST_PASSED");
