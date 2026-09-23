// @category: parsing
// Loads an inventory JSON document into typed interfaces, computes stock value and tag stats,
// and writes a restock order as JSON.
import { readFileSync, writeFileSync } from "node:fs";

interface Item {
  sku: string;
  name: string;
  qty: number;
  price: number;
  tags: string[];
}

interface Inventory {
  warehouse: string;
  updated: string;
  items: Item[];
}

interface RestockLine {
  sku: string;
  order: number;
  cost: number;
}

const LOW_STOCK = 5;
const TARGET = 20;

const inv = JSON.parse(readFileSync("fixtures/inventory.json", "utf8")) as Inventory;
console.log(`${inv.warehouse} (updated ${inv.updated}): ${inv.items.length} items`);

const totalValue = inv.items.reduce((sum, i) => sum + i.qty * i.price, 0);
console.log(`stock value: $${totalValue.toFixed(2)}`);

const tagCounts: Record<string, number> = {};
for (const item of inv.items) {
  for (const tag of item.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
}
console.log("tags:", tagCounts);
console.log(
  "untagged:",
  inv.items.filter((i) => i.tags.length === 0).map((i) => i.name),
);

const restock: RestockLine[] = inv.items
  .filter((i) => i.qty < LOW_STOCK)
  .map((i) => ({
    sku: i.sku,
    order: TARGET - i.qty,
    cost: +((TARGET - i.qty) * i.price).toFixed(2),
  }));

for (const line of restock) console.log(`restock ${line.sku}: +${line.order} ($${line.cost})`);

const order = {
  warehouse: inv.warehouse,
  lines: restock,
  total: restock.reduce((s, l) => s + l.cost, 0),
  outOfStock: inv.items.filter((i) => i.qty === 0).map((i) => i.sku),
};
writeFileSync("restock.json", JSON.stringify(order, null, 2) + "\n");

const cheapest = [...inv.items].sort((a, b) => a.price - b.price)[0]!;
const priciest = inv.items.reduce((a, b) => (b.price > a.price ? b : a));
console.log(`cheapest: ${cheapest.name}, priciest: ${priciest.name}`);
console.log(JSON.stringify(inv.items.map(({ sku, qty }) => ({ sku, qty }))));
