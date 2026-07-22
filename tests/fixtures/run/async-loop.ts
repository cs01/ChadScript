async function twice(n: number): Promise<number> {
  return n * 2;
}
async function run(): Promise<void> {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    sum = sum + (await twice(i));
  }
  console.log(sum);
}
run();
