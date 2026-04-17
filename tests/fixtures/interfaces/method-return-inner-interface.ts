interface Inner {
  v: number;
}
interface Outer {
  inner: Inner;
  name: string;
}
class S {
  build(): Outer {
    return { inner: { v: 9 }, name: "x" };
  }
}
function main(): void {
  const s = new S();
  const a = s.build().inner;
  if (a.v === 9) {
    console.log("TEST_PASSED");
  }
}
main();
