// A small data pipeline: array higher-order methods (filter/map/reduce), object spread for
// immutable updates, Set for de-duplication, and closures capturing outer state.
interface Order {
  id: number;
  customer: string;
  total: number;
}

const orders: Order[] = [
  { id: 1, customer: "alice", total: 120 },
  { id: 2, customer: "bob", total: 80 },
  { id: 3, customer: "alice", total: 200 },
  { id: 4, customer: "carol", total: 50 },
];

// Distinct customers via a Set.
const customers = new Set<string>(orders.map((o: Order): string => o.customer));
console.log("customers:", [...customers]);

// Large orders, with a captured threshold.
const threshold = 100;
const large = orders.filter((o: Order): boolean => o.total > threshold);
console.log("large order ids:", large.map((o: Order): number => o.id));

// Grand total.
const total = orders.reduce((sum: number, o: Order): number => sum + o.total, 0);
console.log("grand total:", total);

// Apply a 10% discount immutably (object spread), only to large orders.
const discounted = orders.map((o: Order): Order =>
  o.total > threshold ? { ...o, total: o.total * 0.9 } : o,
);
for (const o of discounted) {
  console.log(o.customer + " #" + o.id + " -> " + o.total);
}
