function max(a, b) {
  return a > b ? a : b;
}

function test() {
  // Ternary in function call
  let result = max(5, 10);

  // Ternary as return value
  return result === 10 ? 42 : 0;
}

test();
