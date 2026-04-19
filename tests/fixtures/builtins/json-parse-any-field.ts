// @test expectTestPassed
// Regression for dapweb NOTES #12: JSON.parse<T> where T has an `any`-typed
// field previously emitted broken IR (`@parse_json_any`). Now the parser
// stores the raw JSON source-text of the value as an i8* string, enabling
// the "discriminant dispatch" pattern common in DAP / JSON-RPC / webhook
// routers: peek at a sibling field, then re-parse the polymorphic payload.
interface Envelope {
  command: string;
  body: any;
}
interface LaunchArgs {
  program: string;
  args: string[];
}
const e = JSON.parse<Envelope>(
  '{"command":"launch","body":{"program":"/bin/ls","args":["-la","/tmp"]}}',
);
let ok = e.command === "launch";
const args = JSON.parse<LaunchArgs>(e.body);
ok = ok && args.program === "/bin/ls";
ok = ok && args.args.length === 2;
ok = ok && args.args[0] === "-la" && args.args[1] === "/tmp";
if (ok) console.log("TEST_PASSED");
