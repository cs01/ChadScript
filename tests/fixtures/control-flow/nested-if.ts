function classify(n: number): string {
  if (n < 0) {
    return "negative";
  } else if (n === 0) {
    return "zero";
  } else if (n < 10) {
    return "small";
  } else {
    return "large";
  }
}

console.log(classify(-5));
console.log(classify(0));
console.log(classify(7));
console.log(classify(42));
