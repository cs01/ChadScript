// @category: oop
// The state pattern: a vending machine whose behavior is delegated to state objects, with an
// inventory, coin handling, change making, and a transcript of every action.

interface State {
  readonly name: string;
  insertCoin(m: VendingMachine, cents: number): void;
  select(m: VendingMachine, slot: string): void;
  refund(m: VendingMachine): void;
}

interface Product {
  name: string;
  price: number;
  stock: number;
}

class Idle implements State {
  readonly name = "idle";
  insertCoin(m: VendingMachine, cents: number): void {
    m.credit += cents;
    m.setState(new HasCredit());
    m.say(`credit ${m.credit}`);
  }
  select(m: VendingMachine, _slot: string): void {
    m.say("insert coins first");
  }
  refund(m: VendingMachine): void {
    m.say("nothing to refund");
  }
}

class HasCredit implements State {
  readonly name = "has-credit";
  insertCoin(m: VendingMachine, cents: number): void {
    m.credit += cents;
    m.say(`credit ${m.credit}`);
  }
  select(m: VendingMachine, slot: string): void {
    const p = m.products.get(slot);
    if (!p) return m.say(`no slot ${slot}`);
    if (p.stock === 0) return m.say(`${p.name} is sold out`);
    if (m.credit < p.price) return m.say(`${p.name} costs ${p.price}, credit is ${m.credit}`);
    p.stock--;
    m.credit -= p.price;
    m.say(`vend ${p.name}`);
    m.sales += p.price;
    if (m.credit > 0) this.refund(m);
    else m.setState(new Idle());
    if ([...m.products.values()].every((x) => x.stock === 0)) m.setState(new SoldOut());
  }
  refund(m: VendingMachine): void {
    m.say(`change: ${makeChange(m.credit).join("+") || "0"}`);
    m.credit = 0;
    m.setState(new Idle());
  }
}

class SoldOut implements State {
  readonly name = "sold-out";
  insertCoin(m: VendingMachine, cents: number): void {
    m.say(`sold out, returning ${cents}`);
  }
  select(m: VendingMachine): void {
    m.say("sold out");
  }
  refund(m: VendingMachine): void {
    m.say("nothing to refund");
  }
}

function makeChange(cents: number): number[] {
  const coins = [100, 25, 10, 5, 1];
  const out: number[] = [];
  for (const c of coins) {
    while (cents >= c) {
      out.push(c);
      cents -= c;
    }
  }
  return out;
}

class VendingMachine {
  private state: State = new Idle();
  credit = 0;
  sales = 0;
  readonly transcript: string[] = [];
  constructor(readonly products: Map<string, Product>) {}

  setState(s: State): void {
    this.state = s;
  }
  say(msg: string): void {
    this.transcript.push(`[${this.state.name}] ${msg}`);
  }
  insert(cents: number): this {
    this.state.insertCoin(this, cents);
    return this;
  }
  choose(slot: string): this {
    this.state.select(this, slot);
    return this;
  }
  cancel(): this {
    this.state.refund(this);
    return this;
  }
}

const vm = new VendingMachine(
  new Map([
    ["A1", { name: "Cola", price: 125, stock: 2 }],
    ["B2", { name: "Chips", price: 90, stock: 1 }],
  ]),
);
vm.choose("A1").insert(100).choose("A1").insert(25).choose("A1");
vm.insert(100).insert(100).choose("B2");
vm.insert(25).choose("Z9").cancel().cancel();
vm.insert(200).choose("A1").insert(5).choose("A1").cancel();
vm.insert(125).choose("A1");
console.log(vm.transcript.join("\n"));
console.log(`sales: ${vm.sales}, credit: ${vm.credit}`);
