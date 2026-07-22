const nested = [[1, 2], [3, 4], [5]];
console.log(nested.flat().join(","));
const empty: number[][] = [[], [1], [], [2, 3]];
console.log(empty.flat().join(","));
const strs = [["a", "b"], ["c"]];
console.log(strs.flat().join("-"));
