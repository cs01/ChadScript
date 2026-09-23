interface Order {
  customer: string;
  total: number;
}

const orders: Order[] = [
  { customer: "ada", total: 120 },
  { customer: "lin", total: 80 },
  { customer: "ada", total: 45.5 },
];

const byCustomer = new Map<string, number>();
for (const o of orders) {
  byCustomer.set(o.customer, (byCustomer.get(o.customer) ?? 0) + o.total);
}
for (const name of byCustomer.keys()) {
  console.log(`${name.padEnd(5)}${byCustomer.get(name)}`);
}
