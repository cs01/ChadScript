// @category: data-structures
// A fixed-capacity ring buffer that overwrites the oldest entry, used for a moving average over
// a sensor stream, plus a sliding-window maximum with a monotonic deque.

class RingBuffer {
  private data: number[];
  private start = 0;
  private length = 0;

  constructor(private capacity: number) {
    this.data = [];
    for (let i = 0; i < capacity; i++) this.data.push(0);
  }

  push(x: number): number | undefined {
    let evicted: number | undefined = undefined;
    if (this.length === this.capacity) {
      evicted = this.data[this.start];
      this.data[this.start] = x;
      this.start = (this.start + 1) % this.capacity;
    } else {
      this.data[(this.start + this.length) % this.capacity] = x;
      this.length++;
    }
    return evicted;
  }

  get(i: number): number {
    if (i < 0 || i >= this.length) throw new RangeError("index out of range: " + i);
    return this.data[(this.start + i) % this.capacity] as number;
  }

  toArray(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.length; i++) out.push(this.get(i));
    return out;
  }

  get size(): number {
    return this.length;
  }

  isFull(): boolean {
    return this.length === this.capacity;
  }
}

class MovingAverage {
  private buf: RingBuffer;
  private sum = 0;
  constructor(window: number) {
    this.buf = new RingBuffer(window);
  }
  add(x: number): number {
    const evicted = this.buf.push(x);
    this.sum += x - (evicted === undefined ? 0 : evicted);
    return this.sum / this.buf.size;
  }
}

function slidingMax(xs: number[], k: number): number[] {
  const deque: number[] = [];
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    while (deque.length > 0 && (deque[0] as number) <= i - k) deque.shift();
    while (
      deque.length > 0 &&
      (xs[deque[deque.length - 1] as number] as number) <= (xs[i] as number)
    )
      deque.pop();
    deque.push(i);
    if (i >= k - 1) out.push(xs[deque[0] as number] as number);
  }
  return out;
}

const readings: number[] = [];
let seed = 17;
for (let i = 0; i < 20; i++) {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  readings.push(20 + (seed % 1000) / 100);
}

const avg = new MovingAverage(5);
const smoothed = readings.map((r) => Math.round(avg.add(r) * 100) / 100);
console.log("raw:     " + readings.map((r) => r.toFixed(2)).join(" "));
console.log("average: " + smoothed.map((r) => r.toFixed(2)).join(" "));

const rb = new RingBuffer(3);
for (const x of [1, 2, 3, 4, 5]) {
  const ev = rb.push(x);
  console.log(`push ${x}: [${rb.toArray().join(",")}] evicted=${ev} full=${rb.isFull()}`);
}
try {
  rb.get(3);
} catch (e) {
  console.log(e instanceof RangeError ? "RangeError: " + e.message : "other");
}
console.log(slidingMax([1, 3, -1, -3, 5, 3, 6, 7], 3), slidingMax([9, 8, 7, 6, 5], 2));
