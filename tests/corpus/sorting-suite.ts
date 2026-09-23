// @category: algorithms
// Several sorting algorithms checked against Array.prototype.sort on seeded random data, plus a
// stable sort of records by multiple keys.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Sorter = (xs: number[]) => number[];

const insertionSort: Sorter = (input) => {
  const xs = [...input];
  for (let i = 1; i < xs.length; i++) {
    const v = xs[i]!;
    let j = i - 1;
    while (j >= 0 && xs[j]! > v) {
      xs[j + 1] = xs[j]!;
      j--;
    }
    xs[j + 1] = v;
  }
  return xs;
};

const mergeSort: Sorter = (xs) => {
  if (xs.length <= 1) return xs;
  const mid = Math.floor(xs.length / 2);
  const left = mergeSort(xs.slice(0, mid));
  const right = mergeSort(xs.slice(mid));
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length)
    out.push(left[i]! <= right[j]! ? left[i++]! : right[j++]!);
  return out.concat(left.slice(i), right.slice(j));
};

function quickSort(xs: number[]): number[] {
  if (xs.length < 2) return xs;
  const [pivot, ...rest] = xs;
  const p = pivot!;
  return [...quickSort(rest.filter((x) => x < p)), p, ...quickSort(rest.filter((x) => x >= p))];
}

function heapSort(input: number[]): number[] {
  const a = [...input];
  const n = a.length;
  const sift = (start: number, end: number): void => {
    let root = start;
    while (2 * root + 1 < end) {
      let child = 2 * root + 1;
      if (child + 1 < end && a[child]! < a[child + 1]!) child++;
      if (a[root]! >= a[child]!) return;
      [a[root], a[child]] = [a[child]!, a[root]!];
      root = child;
    }
  };
  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) sift(i, n);
  for (let end = n - 1; end > 0; end--) {
    [a[0], a[end]] = [a[end]!, a[0]!];
    sift(0, end);
  }
  return a;
}

function countingSort(xs: number[], max: number): number[] {
  const counts = new Array<number>(max + 1).fill(0);
  for (const x of xs) counts[x]!++;
  const out: number[] = [];
  counts.forEach((c, v) => {
    for (let i = 0; i < c; i++) out.push(v);
  });
  return out;
}

const rand = mulberry32(42);
const data = Array.from({ length: 200 }, () => Math.floor(rand() * 1000));
const expected = [...data].sort((a, b) => a - b);
const sorters: Record<string, Sorter> = {
  insertion: insertionSort,
  merge: mergeSort,
  quick: quickSort,
  heap: heapSort,
  counting: (xs) => countingSort(xs, 999),
};
for (const [name, sort] of Object.entries(sorters)) {
  const got = sort(data);
  const ok = got.length === expected.length && got.every((v, i) => v === expected[i]);
  console.log(`${name.padEnd(10)} ${ok ? "ok" : "MISMATCH"} first=${got.slice(0, 5).join(",")}`);
}

// Default sort is lexicographic, a classic gotcha.
console.log([10, 9, 1, 100, 25].sort());
console.log(["banana", "Apple", "cherry", "apple"].sort());

interface Person {
  name: string;
  dept: string;
  age: number;
}
const people: Person[] = [
  { name: "Ann", dept: "eng", age: 31 },
  { name: "Bob", dept: "ops", age: 25 },
  { name: "Cid", dept: "eng", age: 25 },
  { name: "Dee", dept: "ops", age: 31 },
  { name: "Eve", dept: "eng", age: 25 },
];
const sorted = [...people].sort((a, b) => a.dept.localeCompare(b.dept) || a.age - b.age);
console.log(sorted.map((p) => `${p.dept}/${p.age}/${p.name}`).join(" "));
