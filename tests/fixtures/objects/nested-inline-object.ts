// @test-skip
interface Point {
  x: number;
  y: number;
}

interface Line {
  start: Point;
  end: Point;
}

interface Inner {
  value: string;
}

interface Outer {
  inner: Inner | null;
}

function test(): void {
  const line: Line = { start: { x: 10, y: 20 }, end: { x: 30, y: 40 } };
  if (line.start.x !== 10 || line.start.y !== 20) {
    console.log("FAIL start: " + line.start.x.toString() + "," + line.start.y.toString());
    return;
  }
  if (line.end.x !== 30 || line.end.y !== 40) {
    console.log("FAIL end");
    return;
  }

  const o: Outer = { inner: { value: "hello" } };
  if (o.inner === null) {
    console.log("FAIL inner is null");
    return;
  }
  if (o.inner.value !== "hello") {
    console.log("FAIL inner value: " + o.inner.value);
    return;
  }

  console.log("TEST_PASSED");
}
test();
