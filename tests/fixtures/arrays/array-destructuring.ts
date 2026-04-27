const nums: number[] = [10, 20, 30];
const [a, b, c] = nums;
console.log(a);
console.log(b);
console.log(c);

const strs: string[] = ["hello", "world"];
const [x, y] = strs;
console.log(x);
console.log(y);

const [first, , third] = nums;
console.log(first);
console.log(third);

function getArray(): number[] {
  return [100, 200, 300];
}
const [p, q, r] = getArray();
console.log(p);
console.log(q);
console.log(r);

let [m, n] = nums;
m = 999;
console.log(m);
console.log(n);
