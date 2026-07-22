interface Inner {
  v: number;
}
interface Outer {
  label: string;
  inner: Inner;
}
const o: Outer = { label: "top", inner: { v: 42 } };
console.log(o.label, o.inner.v);
