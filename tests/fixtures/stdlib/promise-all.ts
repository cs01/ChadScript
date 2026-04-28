async function getNum(n: number): Promise<number> {
  return n * 2;
}

async function run(): Promise<void> {
  const results = await Promise.all([getNum(1), getNum(2), getNum(3)]);
  for (let i = 0; i < results.length; i++) {
    console.log(results[i]);
  }
}

run();
