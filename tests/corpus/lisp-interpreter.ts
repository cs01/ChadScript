// @category: interpreters
// @known-bug: compiler stack overflow in valueTypeOfTsType (src/lower/type-translation.ts) on a recursive type alias (`type Value = ... | Value[]`)
// A small Lisp: reader, environments with lexical scope, special forms (define, lambda, if, let,
// begin, quote), closures, recursion, and list primitives.

type Value = number | string | boolean | Value[] | Lambda | Builtin | null;

interface Lambda {
  kind: "lambda";
  params: string[];
  body: Value;
  env: Env;
}

interface Builtin {
  kind: "builtin";
  name: string;
  fn: (args: Value[]) => Value;
}

class Env {
  private vars = new Map<string, Value>();
  constructor(private readonly parent: Env | null = null) {}
  define(name: string, v: Value): void {
    this.vars.set(name, v);
  }
  lookup(name: string): Value {
    if (this.vars.has(name)) return this.vars.get(name) as Value;
    if (this.parent) return this.parent.lookup(name);
    throw new Error(`unbound symbol: ${name}`);
  }
}

function tokenize(src: string): string[] {
  return src.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/);
}

function read(tokens: string[]): Value {
  const tok = tokens.shift();
  if (tok === undefined) throw new Error("unexpected EOF");
  if (tok === "(") {
    const list: Value[] = [];
    while (tokens[0] !== ")") {
      if (tokens.length === 0) throw new Error("missing )");
      list.push(read(tokens));
    }
    tokens.shift();
    return list;
  }
  if (tok === ")") throw new Error("unexpected )");
  if (tok === "#t") return true;
  if (tok === "#f") return false;
  const n = Number(tok);
  return Number.isNaN(n) ? tok : n;
}

function isCallable(v: Value): v is Lambda | Builtin {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function show(v: Value): string {
  if (Array.isArray(v)) return `(${v.map(show).join(" ")})`;
  if (v === null) return "nil";
  if (v === true) return "#t";
  if (v === false) return "#f";
  if (isCallable(v)) return v.kind === "lambda" ? "<lambda>" : `<builtin ${v.name}>`;
  return String(v);
}

function evaluate(x: Value, env: Env): Value {
  if (typeof x === "string") return env.lookup(x);
  if (!Array.isArray(x)) return x;
  if (x.length === 0) return null;
  const [head, ...rest] = x;
  switch (head) {
    case "quote":
      return rest[0] ?? null;
    case "if": {
      const cond = evaluate(rest[0] ?? null, env);
      return evaluate((cond !== false && cond !== null ? rest[1] : rest[2]) ?? null, env);
    }
    case "define":
      env.define(rest[0] as string, evaluate(rest[1] ?? null, env));
      return null;
    case "lambda":
      return { kind: "lambda", params: rest[0] as string[], body: rest[1] ?? null, env };
    case "let": {
      const inner = new Env(env);
      for (const binding of rest[0] as Value[][]) {
        inner.define(binding[0] as string, evaluate(binding[1] ?? null, env));
      }
      return evaluate(rest[1] ?? null, inner);
    }
    case "begin": {
      let result: Value = null;
      for (const e of rest) result = evaluate(e, env);
      return result;
    }
  }
  const fn = evaluate(head ?? null, env);
  const args = rest.map((a) => evaluate(a, env));
  if (!isCallable(fn)) throw new Error(`not a function: ${show(fn)}`);
  if (fn.kind === "builtin") return fn.fn(args);
  const scope = new Env(fn.env);
  fn.params.forEach((p, i) => scope.define(p, args[i] ?? null));
  return evaluate(fn.body, scope);
}

function builtin(name: string, fn: (args: Value[]) => Value): Builtin {
  return { kind: "builtin", name, fn };
}

const num = (v: Value | undefined): number => {
  if (typeof v !== "number") throw new TypeError(`expected number, got ${show(v ?? null)}`);
  return v;
};

const global = new Env();
global.define(
  "+",
  builtin("+", (a) => a.reduce<number>((s, v) => s + num(v), 0)),
);
global.define(
  "-",
  builtin("-", (a) => (a.length === 1 ? -num(a[0]) : num(a[0]) - num(a[1]))),
);
global.define(
  "*",
  builtin("*", (a) => a.reduce<number>((s, v) => s * num(v), 1)),
);
global.define(
  "<",
  builtin("<", (a) => num(a[0]) < num(a[1])),
);
global.define(
  "=",
  builtin("=", (a) => a[0] === a[1]),
);
global.define(
  "list",
  builtin("list", (a) => a),
);
global.define(
  "car",
  builtin("car", (a) => (a[0] as Value[])[0] ?? null),
);
global.define(
  "cdr",
  builtin("cdr", (a) => (a[0] as Value[]).slice(1)),
);
global.define(
  "cons",
  builtin("cons", (a) => [a[0] ?? null, ...(a[1] as Value[])]),
);
global.define(
  "null?",
  builtin("null?", (a) => Array.isArray(a[0]) && a[0].length === 0),
);

const program = [
  "(define fact (lambda (n) (if (< n 2) 1 (* n (fact (- n 1))))))",
  "(fact 10)",
  "(define fib (lambda (n) (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2))))))",
  "(fib 20)",
  "(define map (lambda (f xs) (if (null? xs) (quote ()) (cons (f (car xs)) (map f (cdr xs))))))",
  "(map (lambda (x) (* x x)) (list 1 2 3 4 5))",
  "(define make-counter (lambda (start) (lambda (step) (+ start step))))",
  "((make-counter 100) 5)",
  "(let ((a 3) (b 4)) (+ (* a a) (* b b)))",
  "(begin (define x 5) (if (= x 5) (quote yes) (quote no)))",
  "(undefined-thing 1)",
  "(car (quote (a b c)))",
  "(+ 1 (quote x))",
  "(1 2 3)",
];
for (const src of program) {
  try {
    console.log(
      `${src.length > 50 ? src.slice(0, 47) + "..." : src} => ${show(evaluate(read(tokenize(src)), global))}`,
    );
  } catch (e) {
    console.log(`${src} !! ${(e as Error).name}: ${(e as Error).message}`);
  }
}
