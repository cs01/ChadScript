// The rewrite of rejected.ts that the diagnostics suggest.
const stock = new Map<string, number>();
stock.set("apples", 3);
stock.set("pears", 0);

for (const fruit of stock.keys()) {
  const count = stock.get(fruit) ?? 0;
  if (count === 0) console.log(`${fruit}: sold out`);
}
