// Two+ awaits in one body (the suspend→resume→suspend path that a GC bug once broke).
async function g(n: number): Promise<number> {
  return n + 1;
}
async function run(): Promise<void> {
  const a = await g(10);
  console.log(a);
  const b = await g(a);
  console.log(b);
  const c = await g(b);
  console.log(c);
}
run();
