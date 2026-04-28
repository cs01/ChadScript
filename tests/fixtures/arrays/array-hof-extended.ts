const nums = [1, 2, 3, 4, 5];

const idx = nums.findIndex((n: number) => n > 3);
console.log(idx);

const notFound = nums.findIndex((n: number) => n > 10);
console.log(notFound);

const allPositive = nums.every((n: number) => n > 0);
console.log(allPositive);

const allBig = nums.every((n: number) => n > 3);
console.log(allBig);

const hasEven = nums.some((n: number) => n % 2 === 0);
console.log(hasEven);

const hasTen = nums.some((n: number) => n === 10);
console.log(hasTen);

const sum = nums.reduce((acc: number, n: number) => acc + n, 0);
console.log(sum);

const product = nums.reduce((acc: number, n: number) => acc * n, 1);
console.log(product);

const words = ["hello", "world", "foo"];
const wordIdx = words.findIndex((w: string) => w === "world");
console.log(wordIdx);

const allLong = words.every((w: string) => w.length > 2);
console.log(allLong);

const someFoo = words.some((w: string) => w === "foo");
console.log(someFoo);
