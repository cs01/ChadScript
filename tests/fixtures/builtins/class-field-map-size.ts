// @test expectTestPassed
// Regression: `s.m.size` / `s.s.size` on a class-instance Map/Set field
// previously segfaulted because the `.size` property handler only wired
// up `this.X.size` access. PR #546 fixed method dispatch for the same
// shape but missed the size-property path.
class Container {
  m: Map<string, number> = new Map();
}
const c = new Container();
c.m.set("a", 1);
c.m.set("b", 2);
let ok = c.m.size === 2;
c.m.clear();
ok = ok && c.m.size === 0;
if (ok) console.log("TEST_PASSED");
