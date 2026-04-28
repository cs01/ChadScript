async function getNum(n: number): Promise<number> {
  return n * 10;
}

async function run(): Promise<void> {
  const winner = await Promise.race([getNum(5), getNum(3), getNum(7)]);
  console.log(winner);
}

run();
