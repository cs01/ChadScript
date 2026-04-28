const nums = [1, 2, 3, 4, 5];
const found = nums.find((x: number) => x > 3);
console.log(found);

const words = ["hello", "world", "foo"];
const w = words.find((s: string) => s === "world");
console.log(w);

const missing = words.find((s: string) => s === "bar");
console.log(missing);

const joined = words.reduce((acc: string, s: string) => acc + " " + s, "start:");
console.log(joined);

const sum = nums.reduce((acc: number, x: number) => acc + x, 0);
console.log(sum);
