async function double(n: number): Promise<number> {
  return n * 2;
}

async function addOne(n: number): Promise<number> {
  return n + 1;
}

async function compute(n: number): Promise<number> {
  const doubled = await double(n);
  const result = await addOne(doubled);
  return result;
}

async function run(): Promise<void> {
  const r1 = await compute(5);
  console.log(r1);

  const r2 = await compute(10);
  console.log(r2);
}

run();
