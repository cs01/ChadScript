const empty: number[] = [];
const nums: number[] = [1, 2, 3];

const mapped = empty.map((x: number): number => x * 2);
if (mapped.length !== 0) throw new Error("map empty");

const filtered = empty.filter((x: number): boolean => x > 0);
if (filtered.length !== 0) throw new Error("filter empty");

const found = nums.find((x: number): boolean => x > 100);
if (found !== 0) throw new Error("find miss should be 0, got " + found);

const idx = nums.findIndex((x: number): boolean => x > 100);
if (idx !== -1) throw new Error("findIndex miss");

const every1 = empty.every((x: number): boolean => x > 0);
if (!every1) throw new Error("every on empty should be true");

const some1 = empty.some((x: number): boolean => x > 0);
if (some1) throw new Error("some on empty should be false");

const rev = empty.reverse();
if (rev.length !== 0) throw new Error("reverse empty");

const sliced = empty.slice(0, 10);
if (sliced.length !== 0) throw new Error("slice empty");

const sliced2 = nums.slice(-100, 100);
if (sliced2.length !== 3) throw new Error("slice extreme indices");

const joined = empty.join(",");
if (joined !== "") throw new Error("join empty");

const concatEmpty = empty.concat(empty);
if (concatEmpty.length !== 0) throw new Error("concat empties");

const indexOf1 = empty.indexOf(5);
if (indexOf1 !== -1) throw new Error("indexOf empty");

const includes1 = empty.includes(5);
if (includes1) throw new Error("includes empty");

const lastIdx = empty.lastIndexOf(5);
if (lastIdx !== -1) throw new Error("lastIndexOf empty");

console.log("TEST_PASSED");
