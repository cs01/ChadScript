class Calc {
  acc: number;
  constructor() {
    this.acc = 0;
  }
  add(x: number): void {
    this.acc += x;
  }
  addTwice(x: number): void {
    this.add(x);
    this.add(x);
  }
  result(): number {
    return this.acc;
  }
}
const calc = new Calc();
calc.addTwice(10);
calc.add(5);
console.log(calc.result());
