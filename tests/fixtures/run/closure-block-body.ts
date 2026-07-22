const classify = (n: number): string => {
  if (n < 0) {
    return "negative";
  }
  if (n === 0) {
    return "zero";
  }
  return "positive";
};
console.log(classify(-5));
console.log(classify(0));
console.log(classify(42));
