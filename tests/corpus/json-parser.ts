// @category: interpreters
// @known-bug: compiler stack overflow in valueTypeOfTsType (src/lower/type-translation.ts) on a recursive type alias (`type Json = ... | Json[]`)
// A hand-written JSON parser (with line/column errors) and pretty-printer, checked against the
// built-in JSON.parse/JSON.stringify on a real document and on malformed inputs.
import { readFileSync, writeFileSync } from "node:fs";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

class JsonSyntaxError extends Error {
  constructor(msg: string, line: number, col: number) {
    super(`${msg} at ${line}:${col}`);
    this.name = "JsonSyntaxError";
  }
}

class JsonParser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): Json {
    const v = this.value();
    this.ws();
    if (this.i < this.s.length) this.fail("unexpected trailing characters");
    return v;
  }

  private fail(msg: string): never {
    const before = this.s.slice(0, this.i);
    const line = before.split("\n").length;
    const col = this.i - before.lastIndexOf("\n");
    throw new JsonSyntaxError(msg, line, col);
  }

  private ws(): void {
    while (this.i < this.s.length && " \t\n\r".includes(this.s[this.i]!)) this.i++;
  }

  private value(): Json {
    this.ws();
    const c = this.s[this.i];
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"') return this.string();
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return this.number();
    for (const [word, v] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.s.startsWith(word, this.i)) {
        this.i += word.length;
        return v;
      }
    }
    return this.fail(c === undefined ? "unexpected end of input" : `unexpected character '${c}'`);
  }

  private object(): Json {
    const out: { [key: string]: Json } = {};
    this.i++;
    this.ws();
    if (this.s[this.i] === "}") {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      if (this.s[this.i] !== '"') this.fail("expected string key");
      const key = this.string();
      this.ws();
      if (this.s[this.i] !== ":") this.fail("expected ':'");
      this.i++;
      out[key] = this.value();
      this.ws();
      const c = this.s[this.i++];
      if (c === "}") return out;
      if (c !== ",") this.fail("expected ',' or '}'");
    }
  }

  private array(): Json {
    const out: Json[] = [];
    this.i++;
    this.ws();
    if (this.s[this.i] === "]") {
      this.i++;
      return out;
    }
    for (;;) {
      out.push(this.value());
      this.ws();
      const c = this.s[this.i++];
      if (c === "]") return out;
      if (c !== ",") this.fail("expected ',' or ']'");
    }
  }

  private string(): string {
    let out = "";
    this.i++;
    for (;;) {
      const c = this.s[this.i++];
      if (c === undefined) this.fail("unterminated string");
      if (c === '"') return out;
      if (c === "\\") {
        const e = this.s[this.i++];
        const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
        if (e === "u") {
          out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 4), 16));
          this.i += 4;
        } else {
          out += map[e ?? ""] ?? e;
        }
      } else {
        out += c;
      }
    }
  }

  private number(): number {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    if (!m) this.fail("invalid number");
    this.i += m[0].length;
    return Number(m[0]);
  }
}

function pretty(v: Json, indent = ""): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[\n${v.map((x) => indent + "  " + pretty(x, indent + "  ")).join(",\n")}\n${indent}]`;
  }
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 0) return "{}";
    const body = keys.map(
      (k) => `${indent}  ${JSON.stringify(k)}: ${pretty(v[k]!, indent + "  ")}`,
    );
    return `{\n${body.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(v);
}

const text = readFileSync("fixtures/inventory.json", "utf8");
const mine = new JsonParser(text).parse();
const theirs = JSON.parse(text) as Json;
console.log("same structure:", JSON.stringify(mine) === JSON.stringify(theirs));
const printed = pretty(mine);
console.log(
  "pretty matches JSON.stringify(v, null, 2):",
  printed === JSON.stringify(theirs, null, 2),
);
writeFileSync("inventory.pretty.json", printed + "\n");

const cases = [
  '{"a": [1, 2.5e3, -0.25, "x\\ty\\u0041"], "b": {"c": null, "d": true}}',
  "[1, 2,]",
  '{"a" 1}',
  '"open',
  "tru",
  "[1] 2",
  "{}",
];
for (const c of cases) {
  try {
    console.log("ok  ", JSON.stringify(new JsonParser(c).parse()));
  } catch (e) {
    console.log("fail", (e as Error).message);
  }
}
