console.time("loop");
let sum = 0;
for (let i = 0; i < 1000; i++) {
  sum = sum + i;
}
console.log(sum);
