// Async arrow functions: calling one runs its body up to the first await and returns a promise,
// like an async function declaration. Captures work by value and through shared cells, a throw
// rejects the promise, and each call gets its own fiber.
const prefix = "item";
let total = 0;

const describe = async (n: number): Promise<string> => {
  console.log("describe start", n);
  await Promise.resolve(0);
  total += n;
  return prefix + "-" + n;
};

const fail = async (why: string): Promise<number> => {
  await Promise.resolve(0);
  throw new Error("failed: " + why);
};

const noResult = async (): Promise<void> => {
  await Promise.resolve(0);
  console.log("noResult ran, total is", total);
};

async function main(): Promise<void> {
  const a = describe(1);
  const b = describe(2);
  console.log("both started");
  console.log(await a, await b);
  try {
    await fail("on purpose");
  } catch (e) {
    console.log("caught:", String(e));
  }
  await noResult();
  const counter = { hits: 0 };
  const bump = async (by: number): Promise<number> => {
    counter.hits += by;
    return counter.hits;
  };
  console.log(await bump(2), await bump(3));
}

main();
console.log("main returned");
