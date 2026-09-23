// @category: interpreters
// A calculator language: tokenizer, recursive-descent parser to an AST, and an evaluator with
// variables, right-associative ^, unary minus, and built-in functions. Reads a script file.
import { readFileSync } from "node:fs";

type Token =
  | { kind: "num"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "op"; op: string }
  | { kind: "eof" };

type Expr =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "unary"; op: string; arg: Expr }
  | { type: "binary"; op: string; left: Expr; right: Expr }
  | { type: "call"; fn: string; args: Expr[] };

class SyntaxError2 extends Error {}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === " " || ch === "\t") {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      tokens.push({ kind: "num", value: parseFloat(src.slice(i, j)) });
      i = j;
    } else if (/[a-z_]/i.test(ch)) {
      let j = i;
      while (j < src.length && /\w/.test(src[j]!)) j++;
      tokens.push({ kind: "ident", name: src.slice(i, j) });
      i = j;
    } else if ("+-*/%^(),=".includes(ch)) {
      tokens.push({ kind: "op", op: ch });
      i++;
    } else {
      throw new SyntaxError2(`unexpected character '${ch}' at ${i}`);
    }
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }
  private isOp(op: string): boolean {
    const t = this.peek();
    return t.kind === "op" && t.op === op;
  }
  private expect(op: string): void {
    if (!this.isOp(op)) throw new SyntaxError2(`expected '${op}'`);
    this.pos++;
  }

  parse(): Expr {
    const e = this.additive();
    if (this.peek().kind !== "eof") throw new SyntaxError2("trailing input");
    return e;
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.tokens[this.pos++] as { op: string }).op;
      left = { type: "binary", op, left, right: this.multiplicative() };
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const op = (this.tokens[this.pos++] as { op: string }).op;
      left = { type: "binary", op, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Expr {
    if (this.isOp("-")) {
      this.pos++;
      return { type: "unary", op: "-", arg: this.unary() };
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.primary();
    if (this.isOp("^")) {
      this.pos++;
      return { type: "binary", op: "^", left: base, right: this.unary() };
    }
    return base;
  }

  private primary(): Expr {
    const t = this.peek();
    if (t.kind === "num") {
      this.pos++;
      return { type: "num", value: t.value };
    }
    if (t.kind === "ident") {
      this.pos++;
      if (this.isOp("(")) {
        this.pos++;
        const args: Expr[] = [];
        if (!this.isOp(")")) {
          args.push(this.additive());
          while (this.isOp(",")) {
            this.pos++;
            args.push(this.additive());
          }
        }
        this.expect(")");
        return { type: "call", fn: t.name, args };
      }
      return { type: "var", name: t.name };
    }
    if (this.isOp("(")) {
      this.pos++;
      const e = this.additive();
      this.expect(")");
      return e;
    }
    throw new SyntaxError2("unexpected token");
  }
}

const FUNCS: Record<string, (...xs: number[]) => number> = {
  max: Math.max,
  min: Math.min,
  sqrt: Math.sqrt,
  abs: Math.abs,
};

function evaluate(e: Expr, env: Map<string, number>): number {
  switch (e.type) {
    case "num":
      return e.value;
    case "var": {
      const v = env.get(e.name);
      if (v === undefined) throw new ReferenceError(`undefined variable ${e.name}`);
      return v;
    }
    case "unary":
      return -evaluate(e.arg, env);
    case "binary": {
      const l = evaluate(e.left, env);
      const r = evaluate(e.right, env);
      switch (e.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
        case "%":
          return l % r;
        case "^":
          return l ** r;
        default:
          throw new Error(`bad op ${e.op}`);
      }
    }
    case "call": {
      const f = FUNCS[e.fn];
      if (!f) throw new ReferenceError(`unknown function ${e.fn}`);
      return f(...e.args.map((a) => evaluate(a, env)));
    }
  }
}

const env = new Map<string, number>();
const script = readFileSync("fixtures/expr.txt", "utf8").split("\n");
for (const line of [...script, "print nope + 1", "q = 3 $ 4", "print (1 + 2"]) {
  const src = line.trim();
  if (!src || src.startsWith("#")) continue;
  try {
    if (src.startsWith("print ")) {
      console.log(evaluate(new Parser(tokenize(src.slice(6))).parse(), env));
    } else {
      const eq = src.indexOf("=");
      const name = src.slice(0, eq).trim();
      env.set(name, evaluate(new Parser(tokenize(src.slice(eq + 1))).parse(), env));
    }
  } catch (err) {
    const e = err as Error;
    console.log(
      `error in "${src}": ${e instanceof SyntaxError2 ? "syntax" : e.name}: ${e.message}`,
    );
  }
}
console.log([...env.entries()].map(([k, v]) => `${k}=${v}`).join(", "));
