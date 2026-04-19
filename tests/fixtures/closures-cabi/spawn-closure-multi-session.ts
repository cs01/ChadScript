// @test-description: two concurrent spawns, each arrow captures its own session id — replaces spawnTagged
// Regression for the dapweb multi-session pattern that previously needed
// spawnTagged (now removed). Each arrow closure captures a distinct Session
// and demuxes cleanly through the trampoline-bridge slot table.
class Session {
  id: string = "";
  out: string = "";
  done: number = 0;
}

const s1 = new Session();
s1.id = "s1";
const s2 = new Session();
s2.id = "s2";

let checked: number = 0;

function maybeCheck(): void {
  if (s1.done === 1 && s2.done === 1 && checked === 0) {
    checked = 1;
    if (s1.out === "one\n" && s2.out === "two\n") {
      console.log("TEST_PASSED");
    } else {
      console.log("FAIL: s1='" + s1.out + "' s2='" + s2.out + "'");
    }
  }
}

child_process.spawn(
  "echo",
  ["one"],
  (d: string) => {
    s1.out = s1.out + d;
  },
  (d: string) => {},
  (c: number) => {
    s1.done = 1;
    maybeCheck();
  },
);

child_process.spawn(
  "echo",
  ["two"],
  (d: string) => {
    s2.out = s2.out + d;
  },
  (d: string) => {},
  (c: number) => {
    s2.done = 1;
    maybeCheck();
  },
);

runEventLoop();
