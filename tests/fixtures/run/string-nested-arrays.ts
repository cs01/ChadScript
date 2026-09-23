// String conversion of arrays whose elements are arrays or mixed values: Array.prototype.toString
// joins with ",", recursively; null and undefined elements are empty; objects are [object Object].
const xs = [1, [2, 3], 4];
console.log(String(xs));
console.log(`${xs}`);
console.log("" + xs);
console.log(xs.join("-"));

const mixed: (number | number[])[] = [1, [2, 3], [], 4];
console.log(String(mixed), `<${mixed}>`, "m=" + mixed, mixed.join(" "));

const deep = [
  [1, 2],
  [3, [4, 5]],
];
console.log(String(deep), deep.join(";"));
const nestedEmpty: number[][][] = [[[]], [[], []], []];
console.log(`(${nestedEmpty})`, nestedEmpty.join("|"));

const objs = [[{ a: 1 }], [{ a: 2 }, { a: 3 }]];
console.log(String(objs));
const mixedObj: (number | { a: number })[] = [1, { a: 2 }];
console.log(String(mixedObj), `${mixedObj}`, mixedObj.join("|"));

const holes: (number[] | null | undefined)[] = [[1], null, undefined, [2, 3]];
console.log(String(holes), holes.join("|"), `${holes}`);

const nested: (number | null)[][] = [[1, null], [], [null]];
console.log(String(nested), nested.join("/"));

const kinds: (string | number[] | boolean)[] = ["a", [1, 2], true, []];
console.log(String(kinds), `${kinds}`, kinds.join());

const nums: (number[] | string)[] = [[1.5, -0], "x", [NaN, Infinity]];
console.log(`${nums}`);

const empties: number[][] = [[], [], []];
console.log(`[${String(empties)}]`, empties.join("+"));

const withMaps: (number | Map<string, number>)[] = [1, new Map<string, number>()];
console.log(String(withMaps));

const strs: (string | string[])[] = ["a", ["b", "c"], ""];
let acc = "";
acc += strs;
console.log(acc);
