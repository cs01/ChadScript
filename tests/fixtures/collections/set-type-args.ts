const numSet = new Set<number>();
numSet.add(42);
numSet.add(99);
console.log(numSet.has(42) ? "yes" : "no");

const strSet = new Set<string>();
strSet.add("hello");
console.log(strSet.has("hello") ? "yes" : "no");

console.log("TEST_PASSED");
