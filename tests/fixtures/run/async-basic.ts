async function double(n: number): Promise<number> {
  return n * 2;
}
async function run(): Promise<void> {
  const a = await double(21);
  console.log(a);
}
run();
