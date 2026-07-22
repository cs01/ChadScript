const data = [5, 10, 15, 20];
let total = 0;
for (let i = 0; i < 6; i++) {
  total += data[i] ?? 0;
}
console.log(total);
