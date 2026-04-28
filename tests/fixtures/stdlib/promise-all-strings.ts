async function greet(name: string): Promise<string> {
  return "hello " + name;
}

async function run(): Promise<void> {
  const results = await Promise.all([greet("alice"), greet("bob"), greet("charlie")]);
  for (let i = 0; i < results.length; i++) {
    console.log(results[i]);
  }
}

run();
