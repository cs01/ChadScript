function identity<T>(x: T): T {
  return x;
}
function first<T>(arr: T[]): T {
  return arr[0];
}
const s = identity<string>("hello");
console.log(s);
const items: string[] = ["a", "b", "c"];
const f = first<string>(items);
console.log(f);
console.log("TEST_PASSED");
