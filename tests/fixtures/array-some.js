function isGreaterThan5(x) {
  return x > 5;
}

function testSome() {
  const arr = [1, 2, 3, 10];
  return arr.some(isGreaterThan5);
}

testSome();
