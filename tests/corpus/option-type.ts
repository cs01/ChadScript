// @category: generics
// @known-bug: compiler stack overflow in involvesAny (src/validate/type-rules.ts) on a generic class whose method returns the class at another type argument (`map<U>(): Option<U>`)
// Option<T> and Either<L, R> as small generic classes with map/flatMap/getOrElse, used to write
// a lookup-and-validate chain without null checks.

abstract class Option<T> {
  abstract map<U>(f: (x: T) => U): Option<U>;
  abstract flatMap<U>(f: (x: T) => Option<U>): Option<U>;
  abstract getOrElse(fallback: T): T;
  abstract isSome(): boolean;
  abstract toString(): string;

  static of<T>(x: T | null | undefined): Option<T> {
    return x === null || x === undefined ? new None<T>() : new Some(x);
  }
}

class Some<T> extends Option<T> {
  constructor(private readonly value: T) {
    super();
  }
  map<U>(f: (x: T) => U): Option<U> {
    return new Some(f(this.value));
  }
  flatMap<U>(f: (x: T) => Option<U>): Option<U> {
    return f(this.value);
  }
  getOrElse(): T {
    return this.value;
  }
  isSome(): boolean {
    return true;
  }
  toString(): string {
    return `Some(${JSON.stringify(this.value)})`;
  }
}

class None<T> extends Option<T> {
  map<U>(): Option<U> {
    return new None<U>();
  }
  flatMap<U>(): Option<U> {
    return new None<U>();
  }
  getOrElse(fallback: T): T {
    return fallback;
  }
  isSome(): boolean {
    return false;
  }
  toString(): string {
    return "None";
  }
}

type Either<L, R> = { tag: "left"; value: L } | { tag: "right"; value: R };
const left = <L, R>(value: L): Either<L, R> => ({ tag: "left", value });
const right = <L, R>(value: R): Either<L, R> => ({ tag: "right", value });

function mapEither<L, R, R2>(e: Either<L, R>, f: (r: R) => R2): Either<L, R2> {
  return e.tag === "right" ? right(f(e.value)) : e;
}

interface User {
  name: string;
  managerId?: number;
  email?: string;
}

const users = new Map<number, User>([
  [1, { name: "Root", email: "root@corp.example" }],
  [2, { name: "Mia", managerId: 1, email: "mia@corp.example" }],
  [3, { name: "Ned", managerId: 2 }],
  [4, { name: "Oli", managerId: 99 }],
]);

const findUser = (id: number): Option<User> => Option.of(users.get(id));
const managerEmail = (id: number): Option<string> =>
  findUser(id)
    .flatMap((u) => Option.of(u.managerId))
    .flatMap(findUser)
    .flatMap((m) => Option.of(m.email));

for (const id of [1, 2, 3, 4, 5]) {
  console.log(
    `user ${id}: manager email ${managerEmail(id)} -> ${managerEmail(id).getOrElse("(none)")}`,
  );
}
console.log(
  Option.of(21)
    .map((x) => x * 2)
    .toString(),
  Option.of<number>(null)
    .map((x) => x * 2)
    .isSome(),
);

function parseAge(s: string): Either<string, number> {
  const n = Number(s);
  if (!Number.isInteger(n)) return left(`"${s}" is not an integer`);
  if (n < 0 || n > 150) return left(`${n} is out of range`);
  return right(n);
}
for (const s of ["42", "-3", "abc", "150"]) {
  const r = mapEither(parseAge(s), (n) => (n >= 18 ? "adult" : "minor"));
  console.log(s, r.tag === "right" ? `ok: ${r.value}` : `error: ${r.value}`);
}
