// @category: generics
// A generic in-memory repository with a fluent query builder (where/orderBy/limit), constrained
// generics, keyof-typed field access, and a JSON snapshot written to disk.
import { writeFileSync } from "node:fs";

interface Entity {
  id: number;
}

type Comparable = string | number | boolean;

class Query<T extends Entity> {
  private filters: ((x: T) => boolean)[] = [];
  private order: { key: keyof T; dir: 1 | -1 } | null = null;
  private max = Infinity;

  constructor(private readonly source: readonly T[]) {}

  where<K extends keyof T>(key: K, op: "=" | "<" | ">" | "contains", value: T[K]): this {
    this.filters.push((x) => {
      const v = x[key];
      switch (op) {
        case "=":
          return v === value;
        case "<":
          return (v as Comparable) < (value as Comparable);
        case ">":
          return (v as Comparable) > (value as Comparable);
        case "contains":
          return String(v).includes(String(value));
      }
    });
    return this;
  }

  orderBy(key: keyof T, dir: "asc" | "desc" = "asc"): this {
    this.order = { key, dir: dir === "asc" ? 1 : -1 };
    return this;
  }

  limit(n: number): this {
    this.max = n;
    return this;
  }

  run(): T[] {
    let rows = this.source.filter((x) => this.filters.every((f) => f(x)));
    const order = this.order;
    if (order) {
      rows = [...rows].sort((a, b) => {
        const av = a[order.key] as Comparable;
        const bv = b[order.key] as Comparable;
        return av < bv ? -order.dir : av > bv ? order.dir : 0;
      });
    }
    return rows.slice(0, this.max);
  }
}

class Repository<T extends Entity> {
  private rows = new Map<number, T>();
  private seq = 0;

  insert(data: Omit<T, "id">): T {
    const row = { ...data, id: ++this.seq } as T;
    this.rows.set(row.id, row);
    return row;
  }

  update(id: number, patch: Partial<Omit<T, "id">>): T | undefined {
    const row = this.rows.get(id);
    if (!row) return undefined;
    const next = { ...row, ...patch };
    this.rows.set(id, next);
    return next;
  }

  remove(id: number): boolean {
    return this.rows.delete(id);
  }

  query(): Query<T> {
    return new Query([...this.rows.values()]);
  }

  pluck<K extends keyof T>(key: K): T[K][] {
    return [...this.rows.values()].map((r) => r[key]);
  }

  get count(): number {
    return this.rows.size;
  }
}

interface Book extends Entity {
  title: string;
  author: string;
  year: number;
  available: boolean;
}

const books = new Repository<Book>();
books.insert({ title: "Dune", author: "Herbert", year: 1965, available: true });
books.insert({ title: "Neuromancer", author: "Gibson", year: 1984, available: false });
books.insert({ title: "Hyperion", author: "Simmons", year: 1989, available: true });
books.insert({ title: "Foundation", author: "Asimov", year: 1951, available: true });
books.insert({
  title: "The Left Hand of Darkness",
  author: "Le Guin",
  year: 1969,
  available: true,
});
books.update(2, { available: true });
books.remove(3);

const show = (rows: Book[]): string => rows.map((b) => `${b.id}:${b.title}(${b.year})`).join(", ");
console.log(show(books.query().orderBy("year").run()));
console.log(show(books.query().where("year", ">", 1960).orderBy("title", "desc").run()));
console.log(show(books.query().where("title", "contains", "n").limit(2).run()));
console.log(show(books.query().where("available", "=", true).where("year", "<", 1970).run()));
console.log(books.pluck("author"), books.count);
writeFileSync("books.json", JSON.stringify(books.query().orderBy("id").run()));
