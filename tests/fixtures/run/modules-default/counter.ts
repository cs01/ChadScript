export default class Counter {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
  bump(): void {
    this.n = this.n + 1;
  }
}
