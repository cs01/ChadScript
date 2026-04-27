async function isEven(n: number): Promise<boolean> {
  return n % 2 === 0;
}

async function classify(n: number): Promise<string> {
  const even = await isEven(n);
  if (even) {
    return "even";
  }
  return "odd";
}

async function run(): Promise<void> {
  console.log(await classify(4));
  console.log(await classify(7));
  console.log(await classify(0));
}

run();
