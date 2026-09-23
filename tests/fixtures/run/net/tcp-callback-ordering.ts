// Where network callbacks run relative to promise continuations. "listening" is deferred with
// process.nextTick, so after the main module it runs once the module's microtasks are done; inside
// a callback, the nextTick queue drains before microtasks. Every line comes from one process-wide
// sequence, so the interleaving is the whole point of the fixture.
import * as net from "node:net";

async function steps(label: string): Promise<void> {
  console.log(label, "start");
  await Promise.resolve(0);
  console.log(label, "after first await");
  await Promise.resolve(0);
  console.log(label, "after second await");
}

const server = net.createServer(() => {});
server.on("listening", () => {
  console.log("listening (first listener)");
});
server.listen(0, "127.0.0.1", () => {
  console.log("listening (callback)");
  steps("inside callback");
  server.close(() => {
    console.log("closed");
    steps("inside close");
  });
  console.log("callback end");
});
steps("main");
console.log("main end");
