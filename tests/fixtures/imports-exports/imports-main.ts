// @test-exit-code: 19
// Main file that imports from math-lib

import { add, multiply } from "../arithmetic/math-lib.js";

function compute(x: number, y: number) {
  let sum = add(x, y);
  let product = multiply(x, y);
  return add(sum, product);
}

process.exit(compute(3, 4));
