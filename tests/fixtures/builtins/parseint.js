// Test parseInt with different radixes
function testBase10() {
  return parseInt("42");
}

function testBase16() {
  return parseInt("FF", 16);
}

function testBase2() {
  return parseInt("101", 2);
}

console.log("parseInt('42')=" + testBase10());
console.log("parseInt('FF',16)=" + testBase16());
console.log("parseInt('101',2)=" + testBase2());

process.exit(0);
