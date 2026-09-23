// tsc's subtype reduction types `[[1, 2], [3, [4, 5]]]` as `(number | number[])[][]`: the inner
// `[1, 2]` must be built in that element representation, not its own `number[]`.
const deep = [
  [1, 2],
  [3, [4, 5]],
];
console.log(deep);
console.log(deep[0]);
console.log(JSON.stringify(deep));
for (const row of deep) console.log(row.length, String(row[0]));

const three = [[[1]], [[2, [3]]]];
console.log(three, String(three));

const withStrings = [["a"], ["b", ["c"]]];
console.log(withStrings, withStrings.length);

const opt: (number[] | undefined)[] = [[1, 2], undefined];
console.log(opt);
