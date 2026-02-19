interface Inner {
  value: number;
}

interface Outer {
  inner: Inner;
  name: string;
}

const obj: Outer = { inner: { value: 42 }, name: "test" };
const v = obj.inner.value;
if (v === 42 && obj.name === "test") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: expected 42/test, got " + v.toString() + "/" + obj.name);
}
