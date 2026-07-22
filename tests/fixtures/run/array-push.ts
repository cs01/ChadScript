const xs: number[] = [];
for (let i = 1; i <= 5; i++) {
  xs.push(i * i);
}
console.log(xs.length);
for (const x of xs) {
  console.log(x);
}
