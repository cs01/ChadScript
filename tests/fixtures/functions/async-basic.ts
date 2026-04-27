async function add(a: number, b: number): Promise<number> {
  return a + b;
}

async function greet(name: string): Promise<string> {
  return "hello " + name;
}

async function run(): Promise<void> {
  const sum = await add(10, 20);
  console.log(sum);

  const msg = await greet("world");
  console.log(msg);

  const x = await add(1, 2);
  const y = await add(3, 4);
  console.log(x + y);
}

run();
