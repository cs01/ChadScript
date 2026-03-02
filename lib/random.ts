export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed % 4294967296.0;
    if (this.state < 0.0) {
      this.state = this.state + 4294967296.0;
    }
    if (this.state === 0.0) {
      this.state = 1.0;
    }
  }

  next(): number {
    this.state = (this.state * 1664525.0 + 1013904223.0) % 4294967296.0;
    return this.state / 4294967296.0;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }
}
