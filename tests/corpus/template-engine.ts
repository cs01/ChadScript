// @category: text
// A mustache-like template engine: {{path.to.value}}, {{#if cond}}...{{/if}},
// {{#each list}}...{{this}}...{{/each}}. Renders a letter to a file.
import { readFileSync, writeFileSync } from "node:fs";

type Context = { [key: string]: unknown };

function lookup(ctx: Context, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Context)[part];
  }
  return cur;
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(stringify).join(", ");
  return String(v);
}

function render(template: string, ctx: Context): string {
  const block = /\{\{#(if|each) (\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  const expanded = template.replace(block, (_m, kind: string, path: string, body: string) => {
    const value = lookup(ctx, path);
    if (kind === "if") return value ? render(body, ctx) : "";
    if (!Array.isArray(value)) return "";
    return value.map((item) => render(body, { ...ctx, this: item })).join("");
  });
  return expanded.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_m, path: string) =>
    stringify(lookup(ctx, path)),
  );
}

const template = readFileSync("fixtures/template.txt", "utf8");
const context: Context = {
  name: "Ada Lovelace",
  company: "Analytical Engines Ltd.",
  premium: true,
  order: { id: 1843, count: 3 },
  items: ["Punch cards", "Brass gears", "Notes on the engine"],
};

const letter = render(template, context);
writeFileSync("letter.txt", letter);
console.log(letter);

const plain = render(template, { ...context, premium: false, items: [] });
writeFileSync("letter-plain.txt", plain);
console.log(`plain letter has ${plain.split("\n").length} lines`);
