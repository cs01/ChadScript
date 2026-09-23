// async/await with Node's ordering: synchronous code runs before any awaited continuation,
// Promise.all keeps input order, a rejection is caught by try/catch around the await, and
// timers run after the microtasks drain.
async function score(name: string): Promise<number> {
  console.log("scoring", name);
  return name.length * 10;
}

async function offline(): Promise<number> {
  throw new Error("offline");
}

async function main(): Promise<void> {
  console.log("start");
  const scores = await Promise.all([score("slow"), score("fast")]);
  console.log("scores", scores);
  try {
    await offline();
  } catch (e) {
    console.log("caught", String(e));
  }
}

setTimeout(() => {
  console.log("timer fires last");
}, 0);
main();
console.log("main() returned first");
