// Main file that imports from math-lib

import { add, multiply } from './math-lib.js';

function compute(x, y) {
  let sum = add(x, y);
  let product = multiply(x, y);
  return add(sum, product);
}

compute(3, 4);
