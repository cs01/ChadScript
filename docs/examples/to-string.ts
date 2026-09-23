// How String(), template literals, + and join turn values into text, the same as Node.
interface Point {
  x: number;
  y: number;
}

class Money {
  cents: number;
  constructor(cents: number) {
    this.cents = cents;
  }
  toString(): string {
    return `$${(this.cents / 100).toString()}`;
  }
}

const p: Point = { x: 1, y: 2 };
const xs = [[1, 2], [3]];
const price = new Money(1250);

console.log(String(p), `${p}`, "p=" + p);
console.log(String(xs), `[${xs}]`, [p, p].join(" | "));
console.log(String(price), `total: ${price}`, "cost " + price);
console.log(`${null} ${undefined} ${true}`);
