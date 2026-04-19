// @test-description: setTimeout with arrow closure capturing class-instance `this` state fires via trampoline
// Exercises the one-shot path: arrow captures `this` (implicitly via a
// locally-aliased pointer), the trampoline slot is allocated on setup and
// freed automatically when the timer fires.
class Foo {
  state: number = 0;
  fired: number = 0;
}

const foo = new Foo();
foo.state = 42;

setTimeout(() => {
  foo.fired = foo.state;
}, 10);

runEventLoop();

if (foo.fired === 42) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: fired=" + foo.fired);
}
