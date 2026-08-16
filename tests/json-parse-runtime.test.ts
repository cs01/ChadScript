// JSON.parse's DIVERGENT cases, pinned without a Node oracle.
//
// Shape validation is the one place the compiler deliberately does not match Node: for JSON that
// parses but does not match the target type, Node hands back the wrong-shaped object and the
// program reads `undefined` later (or never notices), while we throw at the parse. There is no
// oracle agreement to compare against, so these are asserted directly instead of differentially —
// still fully automatic, just not Node-differential. Valid-input behavior stays in
// tests/fixtures/run/json-parse-*.ts, where Node IS the oracle.
//
// Malformed input and non-ASCII are here for the same reason: Node throws a SyntaxError whose
// message text is its own, and non-ASCII is a deliberate refusal (the charter locks strings to
// ASCII-exact), so neither can be byte-compared against Node either.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProgram } from "../src/frontend/program.js";
import { validate } from "../src/validate/validate.js";
import { emitIr, linkIr, runtimeObjects } from "../src/driver/build.js";
import { run } from "./harness/differential.js";

const PRELUDE = `interface Rec {
  n: number;
  s: string;
  inner: Inner;
  list: number[];
}
interface Inner {
  flag: boolean;
}
`;

async function runProgram(body: string): Promise<{ stdout: string; exit: number | null }> {
  const dir = mkdtempSync(join(tmpdir(), "chadv2-jsonrt-"));
  const src = join(dir, "prog.ts");
  writeFileSync(src, PRELUDE + body);
  const loaded = loadProgram(src);
  validate(loaded);
  const irPath = join(dir, "out.ll");
  writeFileSync(irPath, emitIr(loaded));
  const bin = join(dir, "prog");
  await linkIr(irPath, bin, "2", runtimeObjects());
  const r = await run(bin, []);
  return { stdout: r.stdout, exit: r.exit };
}

// Each case is a JSON text that PARSES as JSON but disagrees with `Rec` somewhere, plus the
// substring of the thrown message that must name where.
const MISMATCHES: Array<{ name: string; json: string; mentions: string }> = [
  {
    name: "wrong scalar type",
    json: '{"n":"not a number","s":"x","inner":{"flag":true},"list":[]}',
    mentions: "value.n",
  },
  {
    name: "missing required property",
    json: '{"s":"x","inner":{"flag":true},"list":[]}',
    mentions: "value.n",
  },
  {
    name: "nested property wrong type",
    json: '{"n":1,"s":"x","inner":{"flag":3},"list":[]}',
    mentions: "value.inner.flag",
  },
  {
    name: "array element wrong type",
    json: '{"n":1,"s":"x","inner":{"flag":true},"list":[1,"two"]}',
    mentions: "value.list[]",
  },
  {
    name: "root is not an object",
    json: "[1,2,3]",
    mentions: "value",
  },
  {
    name: "null where a value is required",
    json: '{"n":null,"s":"x","inner":{"flag":true},"list":[]}',
    mentions: "value.n",
  },
];

for (const c of MISMATCHES) {
  test(`json shape mismatch throws: ${c.name}`, async () => {
    const escaped = c.json.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const { stdout, exit } = await runProgram(
      `try {\n  const r: Rec = JSON.parse('${escaped}');\n  console.log("NO THROW", r.n);\n} catch (e) {\n  console.log("threw:", String(e));\n}\n`,
    );
    assert.equal(exit, 0, "the program should catch the throw and exit cleanly");
    assert.ok(!stdout.includes("NO THROW"), `shape mismatch was not rejected: ${stdout}`);
    assert.ok(
      stdout.includes(c.mentions),
      `message should name the failing path ${c.mentions}, got: ${stdout.trim()}`,
    );
  });
}

const MALFORMED: Array<{ name: string; json: string }> = [
  { name: "trailing comma", json: '{"n":1,}' },
  { name: "single quotes", json: "{'n':1}" },
  { name: "unquoted key", json: "{n:1}" },
  { name: "trailing content", json: '{"n":1} extra' },
  { name: "leading zero", json: '{"n":01}' },
  { name: "leading plus", json: '{"n":+1}' },
  { name: "NaN literal", json: '{"n":NaN}' },
  { name: "Infinity literal", json: '{"n":Infinity}' },
  { name: "unterminated string", json: '{"n":"abc}' },
  { name: "empty input", json: "" },
];

for (const c of MALFORMED) {
  test(`json malformed input throws: ${c.name}`, async () => {
    const escaped = c.json.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const { stdout, exit } = await runProgram(
      `try {\n  const r: Rec = JSON.parse('${escaped}');\n  console.log("NO THROW", r.n);\n} catch (e) {\n  console.log("threw:", String(e));\n}\n`,
    );
    assert.equal(exit, 0);
    assert.ok(!stdout.includes("NO THROW"), `malformed JSON was accepted: ${stdout}`);
    assert.ok(stdout.includes("JSON.parse"), `expected a JSON.parse error, got: ${stdout.trim()}`);
  });
}

test("json non-ASCII is refused rather than approximated", async () => {
  // The escape must survive to RUNTIME: written as a single backslash in the generated source,
  // tsc would decode it and the program would be rejected at COMPILE time as a non-ASCII string
  // literal (a different rule). Doubling it makes the source ASCII and hands `\u00e9` to the JSON
  // parser, which is the refusal under test — the charter locks strings to ASCII-exact, so
  // producing the character would break an invariant the rest of the language relies on.
  const json = '{"n":1,"s":"caf\\\\u00e9","inner":{"flag":true},"list":[]}';
  const { stdout, exit } = await runProgram(
    `try {\n  const r: Rec = JSON.parse('${json}');\n  console.log("NO THROW", r.s);\n} catch (e) {\n  console.log("threw:", String(e));\n}\n`,
  );
  assert.equal(exit, 0);
  assert.ok(!stdout.includes("NO THROW"), `non-ASCII was accepted: ${stdout}`);
  assert.ok(stdout.includes("non-ASCII"), `expected the ASCII refusal, got: ${stdout.trim()}`);
});
