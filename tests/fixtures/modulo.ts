function isEven(n: number): boolean {
  return n % 2 === 0;
}

for (let i: number = 0; i < 10; i++) {
  if (isEven(i)) {
    console.log(i);
  }
}
