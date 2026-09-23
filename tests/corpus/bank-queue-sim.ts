// @category: simulation
// A discrete-event simulation of a bank with several tellers: seeded random arrivals and service
// times, an event queue ordered by time, and waiting-time statistics per scenario.

class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed % 2147483647;
    if (this.state <= 0) this.state += 2147483646;
  }
  next(): number {
    this.state = (this.state * 16807) % 2147483647;
    return (this.state - 1) / 2147483646;
  }
  exponential(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }
}

type SimEvent = { time: number; kind: "arrive" | "depart"; customer: number; teller: number };

interface Result {
  tellers: number;
  served: number;
  avgWait: number;
  maxWait: number;
  maxQueue: number;
  utilization: number;
}

function simulate(
  tellers: number,
  customers: number,
  meanArrival: number,
  meanService: number,
  seed: number,
): Result {
  const rng = new Rng(seed);
  const events: SimEvent[] = [];
  const schedule = (e: SimEvent): void => {
    let i = events.length;
    while (i > 0 && events[i - 1]!.time > e.time) i--;
    events.splice(i, 0, e);
  };
  let t = 0;
  for (let c = 0; c < customers; c++) {
    t += rng.exponential(meanArrival);
    schedule({ time: t, kind: "arrive", customer: c, teller: -1 });
  }
  const busy: boolean[] = new Array<boolean>(tellers).fill(false);
  const busyTime: number[] = new Array<number>(tellers).fill(0);
  const queue: { customer: number; since: number }[] = [];
  const waits: number[] = [];
  let maxQueue = 0;
  let now = 0;

  const startService = (customer: number, teller: number, since: number): void => {
    waits.push(now - since);
    busy[teller] = true;
    const service = rng.exponential(meanService);
    busyTime[teller] = (busyTime[teller] ?? 0) + service;
    schedule({ time: now + service, kind: "depart", customer, teller });
  };

  while (events.length > 0) {
    const e = events.shift()!;
    now = e.time;
    if (e.kind === "arrive") {
      const free = busy.indexOf(false);
      if (free >= 0) startService(e.customer, free, now);
      else {
        queue.push({ customer: e.customer, since: now });
        maxQueue = Math.max(maxQueue, queue.length);
      }
    } else {
      busy[e.teller] = false;
      const nextInLine = queue.shift();
      if (nextInLine) startService(nextInLine.customer, e.teller, nextInLine.since);
    }
  }
  const total = waits.reduce((a, b) => a + b, 0);
  return {
    tellers,
    served: waits.length,
    avgWait: total / waits.length,
    maxWait: Math.max(...waits),
    maxQueue,
    utilization: busyTime.reduce((a, b) => a + b, 0) / (tellers * now),
  };
}

console.log("tellers served  avg-wait  max-wait  max-queue  utilization");
for (const tellers of [1, 2, 3, 4]) {
  const r = simulate(tellers, 500, 1.0, 2.5, 12345);
  console.log(
    `${String(r.tellers).padStart(7)} ${String(r.served).padStart(6)} ${r.avgWait.toFixed(3).padStart(9)} ${r.maxWait.toFixed(3).padStart(9)} ${String(r.maxQueue).padStart(10)} ${(r.utilization * 100).toFixed(1).padStart(11)}%`,
  );
}
const rng = new Rng(42);
console.log(Array.from({ length: 5 }, () => rng.next().toFixed(6)).join(" "));
