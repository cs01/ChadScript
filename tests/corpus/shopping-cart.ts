// @category: scripts
// A shopping cart: catalog lookup, quantities, percentage and buy-one-get-one discounts, tax,
// and a formatted receipt written to a file.
import { writeFileSync } from "node:fs";

interface Product {
  sku: string;
  name: string;
  price: number;
  taxable: boolean;
}

interface LineItem {
  product: Product;
  qty: number;
}

type Discount = { kind: "percent"; sku: string; pct: number } | { kind: "bogo"; sku: string };

const catalog: Product[] = [
  { sku: "APL", name: "Apples (1 lb)", price: 1.99, taxable: false },
  { sku: "BRD", name: "Sourdough Bread", price: 4.5, taxable: false },
  { sku: "SOAP", name: "Dish Soap", price: 3.25, taxable: true },
  { sku: "BAT", name: "AA Batteries (4)", price: 6.99, taxable: true },
  { sku: "CHS", name: "Cheddar", price: 5.49, taxable: false },
];

const TAX_RATE = 0.0825;

function findProduct(sku: string): Product {
  const p = catalog.find((c) => c.sku === sku);
  if (p === undefined) throw new Error("unknown sku " + sku);
  return p;
}

const cart: LineItem[] = [];
function add(sku: string, qty: number): void {
  const existing = cart.find((l) => l.product.sku === sku);
  if (existing) existing.qty += qty;
  else cart.push({ product: findProduct(sku), qty });
}

add("APL", 3);
add("BRD", 1);
add("SOAP", 2);
add("BAT", 1);
add("APL", 2);
add("CHS", 2);
try {
  add("XYZ", 1);
} catch (e) {
  console.log("warning: " + (e as Error).message);
}

const discounts: Discount[] = [
  { kind: "percent", sku: "BAT", pct: 20 },
  { kind: "bogo", sku: "CHS" },
];

const lines: string[] = [];
let subtotal = 0;
let savings = 0;
let taxable = 0;
for (const item of cart) {
  const gross = item.product.price * item.qty;
  let off = 0;
  for (const d of discounts) {
    if (d.sku !== item.product.sku) continue;
    if (d.kind === "percent") off += (gross * d.pct) / 100;
    else off += Math.floor(item.qty / 2) * item.product.price;
  }
  const net = gross - off;
  subtotal += net;
  savings += off;
  if (item.product.taxable) taxable += net;
  lines.push(
    `${item.product.name.padEnd(18)} ${String(item.qty).padStart(2)} x ${item.product.price.toFixed(2).padStart(5)} = ${net.toFixed(2).padStart(6)}${off > 0 ? `  (saved ${off.toFixed(2)})` : ""}`,
  );
}
const tax = Math.round(taxable * TAX_RATE * 100) / 100;
lines.push("-".repeat(40));
lines.push(`${"Subtotal".padEnd(30)}${subtotal.toFixed(2).padStart(10)}`);
lines.push(`${"Tax".padEnd(30)}${tax.toFixed(2).padStart(10)}`);
lines.push(`${"TOTAL".padEnd(30)}${(subtotal + tax).toFixed(2).padStart(10)}`);
lines.push(`You saved $${savings.toFixed(2)} today!`);

const receipt = lines.join("\n");
console.log(receipt);
writeFileSync("receipt.txt", receipt + "\n");
