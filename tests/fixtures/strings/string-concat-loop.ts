function build(n: number): string {
  let r = "";
  let i = 0;
  while (i < n) {
    r = r + "x";
    i = i + 1;
  }
  return r;
}

function buildMixed(n: number): string {
  let r = "";
  let i = 0;
  while (i < n) {
    r = r + "item" + i + ",";
    i = i + 1;
  }
  return r;
}

console.log(build(10).length);
console.log(build(10));
console.log(buildMixed(3).length);
console.log(buildMixed(3));
