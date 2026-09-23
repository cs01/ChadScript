// @known-bug: util.inspect breaks arrays and objects across lines once they exceed the 72/80 column budget; we always print one line
const long: number[] = [];
for (let i = 0; i < 30; i++) long.push(i * 1000);
console.log(long);
const o = {
  alpha: "aaaaaaaaaaaaaaaa",
  beta: "bbbbbbbbbbbbbbbbbbbb",
  gamma: "cccccccccccccccccccc",
  delta: 12345,
};
console.log(o);
console.log([o, o]);
