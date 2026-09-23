// Entry file: `bin/chad build main.ts -o stats` follows the imports.
import { mean, median } from "./stats";
import formatRow from "./format";

const samples: number[] = [12, 7, 3, 21, 9, 14];
console.log(formatRow("mean", mean(samples)));
console.log(formatRow("median", median(samples)));
