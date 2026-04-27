let count: number = 0;
for (let i: number = 0; i < 1000; i = i + 1) {
  if (i % 3 === 0) {
    count = count + 1;
  }
}
console.log(count);
