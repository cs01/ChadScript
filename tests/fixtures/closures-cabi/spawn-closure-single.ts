// @test-description: child_process.spawn arrow-function closure mutates captured object's numeric field
// Captures `session` (class instance pointer). Since ChadScript closures
// capture BY VALUE but pointers-to-objects aliasing means field writes on
// the pointed-to object are still visible outside the arrow — proving the
// trampoline-bridge correctly routes the env each time libuv fires a cb.
class Session {
  counter: number = 0;
  exitFired: number = 0;
}

const session = new Session();

child_process.spawn(
  "echo",
  ["ok"],
  (d: string) => {
    session.counter = session.counter + 1;
  },
  (d: string) => {},
  (c: number) => {
    session.exitFired = 1;
  },
);

runEventLoop();

if (session.counter === 1 && session.exitFired === 1) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: counter=" + session.counter + " exitFired=" + session.exitFired);
}
