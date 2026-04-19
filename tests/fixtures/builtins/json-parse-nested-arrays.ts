// @test expectTestPassed
// Regression for dapweb NOTES #8. Before this fix JSON.parse<T> with a
// nested T[] field emitted broken IR (`@parse_json_number[]`), and even
// the IR-valid cases returned bogus values because member access
// re-routed through csyyjson_obj_get using the struct pointer as a
// yyjson handle.
interface StopBody {
  reason: string;
  threadId: number;
  hitBreakpointIds: number[];
  paths: string[];
}
const b = JSON.parse<StopBody>(
  '{"reason":"breakpoint","threadId":42,"hitBreakpointIds":[1,5,9],"paths":["/a.ts","/b.ts"]}',
);
let ok = b.reason === "breakpoint";
ok = ok && b.threadId === 42;
ok = ok && b.hitBreakpointIds.length === 3;
ok = ok && b.paths.length === 2;
ok = ok && b.hitBreakpointIds[0] === 1 && b.hitBreakpointIds[2] === 9;
ok = ok && b.paths[0] === "/a.ts" && b.paths[1] === "/b.ts";
if (ok) console.log("TEST_PASSED");
