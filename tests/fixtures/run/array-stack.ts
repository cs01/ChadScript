const stack: number[] = [];
stack.push(10);
stack.push(20);
stack.push(30);
let out = 0;
while (stack.length > 0) {
  const top = stack.pop();
  if (top !== undefined) {
    out = out * 10 + top;
  }
}
console.log(out);
