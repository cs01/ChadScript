// @expect-reject: CS1220
async function g(n: number): Promise<number> {
  return n;
}
async function run(): Promise<void> {
  const x = await Promise.race([g(1), g(2)]);
  console.log(x);
}
run();
