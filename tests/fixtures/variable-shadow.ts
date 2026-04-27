let x: number = 10;

function inner(): number {
  let x: number = 20;
  return x;
}

console.log(x);
console.log(inner());
console.log(x);
