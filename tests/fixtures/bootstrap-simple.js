// Bootstrap test - compile a simple version with ChadScript features only

function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

function compute() {
  let x = add(5, 3);
  let y = multiply(x, 2);
  return y;
}

compute();
