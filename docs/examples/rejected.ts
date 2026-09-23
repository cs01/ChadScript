// @expect-reject: CS1222
const stock = new Map<string, number>();
stock.set("apples", 3);
stock.set("pears", 0);

for (const [fruit, count] of stock) {
  if (count == 0) console.log(`${fruit}: sold out`);
}
