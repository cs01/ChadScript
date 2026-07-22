const bits: boolean[] = [];
for (let i = 0; i < 5; i++) {
  bits.push(i % 2 === 0);
}
let trueCount = 0;
for (const b of bits) {
  if (b) {
    trueCount += 1;
  }
}
console.log(trueCount);
