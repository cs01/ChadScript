// @category: async-io
// A producer/consumer pipeline with an async bounded queue: producers await space, consumers
// await items, and a close() drains cleanly. Results are appended to a log file.
import { appendFile, readFile, writeFile } from "node:fs/promises";

class AsyncQueue<T> {
  private items: T[] = [];
  private takers: ((v: T | undefined) => void)[] = [];
  private putters: (() => void)[] = [];
  private closed = false;

  constructor(private readonly capacity: number) {}

  async put(item: T): Promise<void> {
    if (this.closed) throw new Error("queue closed");
    while (this.items.length >= this.capacity) {
      await new Promise<void>((resolve) => this.putters.push(resolve));
    }
    const taker = this.takers.shift();
    if (taker) taker(item);
    else this.items.push(item);
  }

  async take(): Promise<T | undefined> {
    const item = this.items.shift();
    if (item !== undefined) {
      this.putters.shift()?.();
      return item;
    }
    if (this.closed) return undefined;
    return new Promise<T | undefined>((resolve) => this.takers.push(resolve));
  }

  close(): void {
    this.closed = true;
    for (const t of this.takers.splice(0)) t(undefined);
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function producer(
  name: string,
  q: AsyncQueue<string>,
  count: number,
  pace: number,
): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await delay(pace);
    await q.put(`${name}-${i}`);
  }
}

async function consumer(id: number, q: AsyncQueue<string>, out: string[]): Promise<number> {
  let handled = 0;
  for (;;) {
    const job = await q.take();
    if (job === undefined) return handled;
    await delay(3);
    out.push(`c${id}:${job}`);
    await appendFile("work.log", `consumer ${id} handled ${job}\n`);
    handled++;
  }
}

async function main(): Promise<void> {
  await writeFile("work.log", "");
  const q = new AsyncQueue<string>(2);
  const done: string[] = [];
  const consumers = [consumer(1, q, done), consumer(2, q, done)];
  await Promise.all([producer("A", q, 4, 1), producer("B", q, 3, 2)]);
  q.close();
  const counts = await Promise.all(consumers);
  console.log(
    `handled per consumer: ${counts.join(", ")} (total ${counts.reduce((a, b) => a + b, 0)})`,
  );
  const log = await readFile("work.log", "utf8");
  const jobs = log
    .trim()
    .split("\n")
    .map((l) => l.split(" ").pop());
  console.log(`log lines: ${jobs.length}, all jobs: ${[...jobs].sort().join(" ")}`);
  try {
    await q.put("late");
  } catch (e) {
    console.log(`after close: ${(e as Error).message}`);
  }
}

main().catch((e: unknown) => {
  console.log("fatal", e);
  process.exit(1);
});
