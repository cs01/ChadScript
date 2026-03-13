const a = "apple";
const b = "banana";
const c = "cherry";

if (a < b) {
  console.log("a < b: true");
} else {
  console.log("a < b: false");
}

if (b > a) {
  console.log("b > a: true");
} else {
  console.log("b > a: false");
}

if (a > b) {
  console.log("FAIL: a > b should be false");
} else {
  console.log("a > b: false");
}

if (b >= b) {
  console.log("b >= b: true");
} else {
  console.log("FAIL: b >= b should be true");
}

if (a <= a) {
  console.log("a <= a: true");
} else {
  console.log("FAIL: a <= a should be true");
}

if (c > b) {
  console.log("c > b: true");
} else {
  console.log("FAIL: c > b should be true");
}

const strs: string[] = ["apple", "banana", "cherry", "date"];
const gtBanana = strs.filter((item: string): boolean => {
  return item > "banana";
});
if (gtBanana.length === 2) {
  console.log("filter > banana: 2 items");
} else {
  console.log("FAIL: filter > banana got " + gtBanana.length.toString());
}

const ltCherry = strs.filter((item: string): boolean => {
  return item < "cherry";
});
if (ltCherry.length === 2) {
  console.log("filter < cherry: 2 items");
} else {
  console.log("FAIL: filter < cherry got " + ltCherry.length.toString());
}

console.log("TEST_PASSED");
