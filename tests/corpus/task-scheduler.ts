// @category: data-structures
// A generic priority queue (binary heap with a comparator) driving a job scheduler: jobs have
// priorities and durations; workers pick the highest priority job, ties broken by arrival.

class PriorityQueue<T> {
  private heap: T[] = [];
  constructor(private readonly less: (a: T, b: T) => boolean) {}

  get length(): number {
    return this.heap.length;
  }

  push(item: T): void {
    this.heap.push(item);
    this.up(this.heap.length - 1);
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.down(0);
    }
    return top;
  }

  private up(i: number): void {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (!this.less(this.heap[i]!, this.heap[p]!)) return;
      this.swap(i, p);
      i = p;
    }
  }

  private down(i: number): void {
    const n = this.heap.length;
    for (;;) {
      let best = i;
      for (const c of [2 * i + 1, 2 * i + 2]) {
        if (c < n && this.less(this.heap[c]!, this.heap[best]!)) best = c;
      }
      if (best === i) return;
      this.swap(i, best);
      i = best;
    }
  }

  private swap(a: number, b: number): void {
    const t = this.heap[a]!;
    this.heap[a] = this.heap[b]!;
    this.heap[b] = t;
  }
}

interface Job {
  id: number;
  name: string;
  priority: number;
  duration: number;
  arrival: number;
}

const jobs: Job[] = [
  { id: 1, name: "backup", priority: 1, duration: 5, arrival: 0 },
  { id: 2, name: "email", priority: 5, duration: 1, arrival: 0 },
  { id: 3, name: "report", priority: 3, duration: 3, arrival: 1 },
  { id: 4, name: "alert", priority: 9, duration: 1, arrival: 2 },
  { id: 5, name: "index", priority: 3, duration: 2, arrival: 2 },
  { id: 6, name: "cleanup", priority: 1, duration: 2, arrival: 4 },
];

const ready = new PriorityQueue<Job>(
  (a, b) => a.priority > b.priority || (a.priority === b.priority && a.id < b.id),
);
const workers: { name: string; busyUntil: number; done: string[] }[] = [
  { name: "w1", busyUntil: 0, done: [] },
  { name: "w2", busyUntil: 0, done: [] },
];

let time = 0;
let next = 0;
const log: string[] = [];
while (next < jobs.length || ready.length > 0 || workers.some((w) => w.busyUntil > time)) {
  while (next < jobs.length && jobs[next]!.arrival <= time) ready.push(jobs[next++]!);
  for (const w of workers) {
    if (w.busyUntil <= time && ready.length > 0) {
      const job = ready.pop()!;
      w.busyUntil = time + job.duration;
      w.done.push(job.name);
      log.push(`t=${time} ${w.name} starts ${job.name} (p${job.priority}) until t=${w.busyUntil}`);
    }
  }
  time++;
}
console.log(log.join("\n"));
for (const w of workers) console.log(`${w.name}: ${w.done.join(", ")}`);
console.log(`makespan: ${Math.max(...workers.map((w) => w.busyUntil))}`);

const words = new PriorityQueue<string>(
  (a, b) => a.length < b.length || (a.length === b.length && a < b),
);
for (const w of "the quick brown fox jumps over the lazy dog".split(" ")) words.push(w);
const order: string[] = [];
while (words.length) order.push(words.pop()!);
console.log(order.join(" "), words.peek());
