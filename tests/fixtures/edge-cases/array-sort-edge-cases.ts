const empty: number[] = [];
empty.sort();
if (empty.length !== 0) throw new Error("sort empty");

const single: number[] = [42];
single.sort();
if (single[0] !== 42) throw new Error("sort single");

const sorted: number[] = [1, 2, 3];
sorted.sort();
if (sorted[0] !== 1 || sorted[1] !== 2 || sorted[2] !== 3) throw new Error("sort already sorted");

const reversed: number[] = [3, 2, 1];
reversed.sort();
if (reversed[0] !== 1 || reversed[1] !== 2 || reversed[2] !== 3) throw new Error("sort reversed");

const dups: number[] = [3, 1, 3, 1, 2];
dups.sort();
if (dups[0] !== 1 || dups[1] !== 1 || dups[2] !== 2 || dups[3] !== 3 || dups[4] !== 3)
  throw new Error("sort dups");

const strs: string[] = [];
strs.sort();
if (strs.length !== 0) throw new Error("sort empty strings");

const strs2: string[] = ["banana", "apple", "cherry"];
strs2.sort();
if (strs2[0] !== "apple" || strs2[1] !== "banana" || strs2[2] !== "cherry")
  throw new Error("sort strings");

console.log("TEST_PASSED");
