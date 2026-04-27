function abs(x: number): number {
  if (x < 0) {
    return -x;
  } else {
    return x;
  }
}

console.log(abs(-42));
console.log(abs(7));
