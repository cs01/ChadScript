// Promise.resolve(v) wraps an available value in a fulfilled promise; awaiting it yields v.
async function run(): Promise<void> {
  const n = await Promise.resolve(42);
  console.log(n);
  const s = await Promise.resolve("hi");
  console.log(s.toUpperCase());
  const xs = await Promise.resolve([1, 2, 3]);
  console.log(xs.length, xs[0]);
}
run();
