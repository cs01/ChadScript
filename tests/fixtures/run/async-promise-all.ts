// Promise.all awaits every input promise and resolves to the values in order; a rejection in any
// rejects the whole (caught here). The result is usable as a plain array (.length/.join/for-of).
async function twice(n: number): Promise<number> {
  return n * 2;
}
async function fail(): Promise<number> {
  throw new Error("boom");
}
async function run(): Promise<void> {
  const xs = await Promise.all([twice(1), twice(2), twice(3)]);
  console.log(xs, xs.length);
  let sum = 0;
  for (const x of xs) sum += x;
  console.log(sum);
  const doubled: number[] = await Promise.all([twice(10), twice(20)]);
  console.log(doubled.join("-"));
  try {
    await Promise.all([twice(1), fail(), twice(3)]);
    console.log("unreached");
  } catch (e) {
    console.log("all-rejected", String(e));
  }
}
run();
