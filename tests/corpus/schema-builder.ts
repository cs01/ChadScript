// @category: generics
// A zod-like schema builder: chainable validators whose static types flow through generics, so
// `Infer<typeof schema>` gives the parsed type. Parses good and bad inputs.

type Result<T> = { success: true; data: T } | { success: false; errors: string[] };

abstract class Schema<T> {
  protected checks: ((v: T) => string | null)[] = [];
  abstract parseRaw(input: unknown, path: string, errors: string[]): T | undefined;

  refine(check: (v: T) => boolean, message: string): this {
    this.checks.push((v) => (check(v) ? null : message));
    return this;
  }

  protected runChecks(v: T, path: string, errors: string[]): void {
    for (const c of this.checks) {
      const msg = c(v);
      if (msg) errors.push(`${path}: ${msg}`);
    }
  }

  safeParse(input: unknown): Result<T> {
    const errors: string[] = [];
    const data = this.parseRaw(input, "$", errors);
    return errors.length === 0 && data !== undefined
      ? { success: true, data }
      : { success: false, errors };
  }
}

type Infer<S> = S extends Schema<infer T> ? T : never;

class StringSchema extends Schema<string> {
  parseRaw(input: unknown, path: string, errors: string[]): string | undefined {
    if (typeof input !== "string") {
      errors.push(`${path}: expected string`);
      return undefined;
    }
    this.runChecks(input, path, errors);
    return input;
  }
  min(n: number): this {
    return this.refine((s) => s.length >= n, `must have at least ${n} characters`);
  }
  email(): this {
    return this.refine((s) => /^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(s), "must be an email");
  }
}

class NumberSchema extends Schema<number> {
  parseRaw(input: unknown, path: string, errors: string[]): number | undefined {
    if (typeof input !== "number" || Number.isNaN(input)) {
      errors.push(`${path}: expected number`);
      return undefined;
    }
    this.runChecks(input, path, errors);
    return input;
  }
  int(): this {
    return this.refine(Number.isInteger, "must be an integer");
  }
  between(lo: number, hi: number): this {
    return this.refine((n) => n >= lo && n <= hi, `must be between ${lo} and ${hi}`);
  }
}

class ArraySchema<T> extends Schema<T[]> {
  constructor(private item: Schema<T>) {
    super();
  }
  parseRaw(input: unknown, path: string, errors: string[]): T[] | undefined {
    if (!Array.isArray(input)) {
      errors.push(`${path}: expected array`);
      return undefined;
    }
    const out = input.map((x, i) => this.item.parseRaw(x, `${path}[${i}]`, errors));
    this.runChecks(out as T[], path, errors);
    return out as T[];
  }
}

class ObjectSchema<Shape extends Record<string, Schema<any>>> extends Schema<{
  [K in keyof Shape]: Infer<Shape[K]>;
}> {
  constructor(private shape: Shape) {
    super();
  }
  parseRaw(
    input: unknown,
    path: string,
    errors: string[],
  ): { [K in keyof Shape]: Infer<Shape[K]> } | undefined {
    if (typeof input !== "object" || input === null) {
      errors.push(`${path}: expected object`);
      return undefined;
    }
    const out: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(this.shape)) {
      out[key] = schema.parseRaw((input as Record<string, unknown>)[key], `${path}.${key}`, errors);
    }
    return out as { [K in keyof Shape]: Infer<Shape[K]> };
  }
}

const s = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  array: <T>(item: Schema<T>) => new ArraySchema(item),
  object: <Shape extends Record<string, Schema<any>>>(shape: Shape) => new ObjectSchema(shape),
};

const User = s.object({
  name: s.string().min(2),
  email: s.string().email(),
  age: s.number().int().between(0, 130),
  tags: s.array(s.string().min(1)).refine((t) => t.length <= 3, "at most 3 tags"),
});
type User = Infer<typeof User>;

const inputs: unknown[] = [
  { name: "Ada", email: "ada@example.com", age: 36, tags: ["math", "engines"] },
  { name: "B", email: "not-an-email", age: 36.5, tags: ["", "x", "y", "z"] },
  { name: 42, email: "x@y.io", age: "old", tags: "none" },
  null,
];
for (const input of inputs) {
  const r = User.safeParse(input);
  if (r.success) {
    const u: User = r.data;
    console.log(`ok: ${u.name} <${u.email}> ${u.age} [${u.tags.join(", ")}]`);
  } else {
    console.log(`invalid:\n  ${r.errors.join("\n  ")}`);
  }
}
