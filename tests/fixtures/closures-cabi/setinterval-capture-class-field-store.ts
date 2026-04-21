// @test-description: setInterval result stored in class-field via captured class ptr; closure reads class field type via concreteClass plumbing
class T {
  h: string = "";
  n: number = 0;
}

const t = new T();

t.h = setInterval(() => {
  t.n = t.n + 1;
}, 10);

setTimeout(() => {
  clearInterval(t.h);
}, 200);

runEventLoop();

if (t.n >= 3) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: n=" + t.n);
}
