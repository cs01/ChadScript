// @category: oop
// The observer pattern: a stock ticker subject with seeded price moves, and several observers
// (alerting, moving average, portfolio valuation) that subscribe and unsubscribe.

interface Quote {
  symbol: string;
  price: number;
  tick: number;
}

interface Observer {
  update(q: Quote): void;
}

class Ticker {
  private observers = new Set<Observer>();
  private prices = new Map<string, number>();
  private tick = 0;
  private seed: number;

  constructor(initial: Record<string, number>, seed: number) {
    for (const [s, p] of Object.entries(initial)) this.prices.set(s, p);
    this.seed = seed;
  }

  subscribe(o: Observer): () => void {
    this.observers.add(o);
    return () => {
      this.observers.delete(o);
    };
  }

  private random(): number {
    this.seed = (this.seed * 48271) % 2147483647;
    return this.seed / 2147483647;
  }

  step(): void {
    this.tick++;
    for (const [symbol, price] of this.prices) {
      const change = (this.random() - 0.5) * 0.08;
      const next = Math.round(price * (1 + change) * 100) / 100;
      this.prices.set(symbol, next);
      for (const o of this.observers) o.update({ symbol, price: next, tick: this.tick });
    }
  }
}

class Alert implements Observer {
  readonly fired: string[] = [];
  constructor(
    private symbol: string,
    private above: number,
  ) {}
  update(q: Quote): void {
    if (q.symbol === this.symbol && q.price > this.above)
      this.fired.push(`t${q.tick}: ${q.symbol} ${q.price} > ${this.above}`);
  }
}

class MovingAverage implements Observer {
  private window: number[] = [];
  latest = 0;
  constructor(
    private symbol: string,
    private size: number,
  ) {}
  update(q: Quote): void {
    if (q.symbol !== this.symbol) return;
    this.window.push(q.price);
    if (this.window.length > this.size) this.window.shift();
    this.latest = this.window.reduce((a, b) => a + b, 0) / this.window.length;
  }
}

class Portfolio implements Observer {
  private last = new Map<string, number>();
  constructor(private holdings: Map<string, number>) {}
  update(q: Quote): void {
    this.last.set(q.symbol, q.price);
  }
  value(): number {
    let total = 0;
    for (const [s, qty] of this.holdings) total += qty * (this.last.get(s) ?? 0);
    return Math.round(total * 100) / 100;
  }
}

const ticker = new Ticker({ ACME: 100, GLOBEX: 50, INITECH: 20 }, 2024);
const alert = new Alert("ACME", 104);
const avg = new MovingAverage("GLOBEX", 3);
const folio = new Portfolio(
  new Map([
    ["ACME", 10],
    ["INITECH", 100],
  ]),
);
ticker.subscribe(alert);
const stopAvg = ticker.subscribe(avg);
ticker.subscribe(folio);

for (let i = 1; i <= 12; i++) {
  ticker.step();
  if (i % 3 === 0)
    console.log(`tick ${i}: portfolio ${folio.value()}, GLOBEX avg ${avg.latest.toFixed(3)}`);
  if (i === 6) stopAvg();
}
console.log(alert.fired.length ? alert.fired.join("\n") : "no alerts");
