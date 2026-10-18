// @expect-reject: CS1237
// tsc compares method parameters bivariantly; the call passes `number | undefined`.
interface I {
  m(x?: number): number;
}
class C implements I {
  m(x: number): number {
    return x + 1;
  }
}
const i: I = new C();
console.log(i.m());
