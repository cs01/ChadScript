// @category: text
// Word wrapping at a given width with left, right, center and full justification, plus a boxed
// output mode. Writes each variant to a file.
import { readFileSync, writeFileSync } from "node:fs";

type Align = "left" | "right" | "center" | "justify";

function wrap(text: string, width: number): string[][] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[][] = [];
  let current: string[] = [];
  let len = 0;
  for (const word of words) {
    const extra = current.length === 0 ? word.length : word.length + 1;
    if (len + extra > width && current.length > 0) {
      lines.push(current);
      current = [word];
      len = word.length;
    } else {
      current.push(word);
      len += extra;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function justify(words: string[], width: number): string {
  if (words.length === 1) return words[0]!;
  const letters = words.reduce((n, w) => n + w.length, 0);
  const gaps = words.length - 1;
  const spaces = width - letters;
  const base = Math.floor(spaces / gaps);
  let extra = spaces % gaps;
  let out = "";
  words.forEach((w, i) => {
    out += w;
    if (i < gaps) {
      out += " ".repeat(base + (extra > 0 ? 1 : 0));
      extra--;
    }
  });
  return out;
}

function format(text: string, width: number, align: Align): string[] {
  const lines = wrap(text, width);
  return lines.map((words, i) => {
    const plain = words.join(" ");
    switch (align) {
      case "left":
        return plain;
      case "right":
        return plain.padStart(width);
      case "center": {
        const left = Math.floor((width - plain.length) / 2);
        return " ".repeat(left) + plain;
      }
      case "justify":
        return i === lines.length - 1 ? plain : justify(words, width);
    }
  });
}

function box(lines: string[], width: number): string[] {
  const top = `+${"-".repeat(width + 2)}+`;
  return [top, ...lines.map((l) => `| ${l.padEnd(width)} |`), top];
}

const text = readFileSync("fixtures/words.txt", "utf8");
const aligns: Align[] = ["left", "right", "center", "justify"];
for (const align of aligns) {
  const lines = format(text, 36, align);
  writeFileSync(`wrapped-${align}.txt`, lines.join("\n") + "\n");
  console.log(
    `${align}: ${lines.length} lines, longest ${Math.max(...lines.map((l) => l.length))}`,
  );
}
console.log(box(format(text, 30, "justify"), 30).join("\n"));
console.log(format("supercalifragilisticexpialidocious is long", 10, "left"));
