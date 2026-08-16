// @expect-reject: CS1232
// A call to an async function must SPAWN a fiber and yield a promise. A forwarding wrapper would
// run the body synchronously instead — right type, wrong semantics.
async function fetchIt(): Promise<number> {
  return 1;
}

const f = fetchIt;
console.log(f());
