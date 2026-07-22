// Two concurrent async functions interleave at each await.
async function g(): Promise<number> {
  return 0;
}
async function f(tag: string): Promise<void> {
  console.log(tag, 1);
  await g();
  console.log(tag, 2);
}
f("x");
f("y");
