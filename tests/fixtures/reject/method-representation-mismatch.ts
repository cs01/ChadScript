// @expect-reject: CS1237
// tsc accepts a `number`-returning function where `number | undefined` is expected, but the two
// return different machine representations, so a call through the interface cannot serve both.
interface Source {
  next(): number | undefined;
}
class Counter implements Source {
  n = 0;
  next(): number | undefined {
    this.n++;
    return this.n < 3 ? this.n : undefined;
  }
}
const fixed: Source = { next: (): number => 7 };
const all: Source[] = [new Counter(), fixed];
for (const s of all) console.log(s.next() ?? -1);
