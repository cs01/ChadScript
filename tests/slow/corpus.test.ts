// Corpus suite: every realistic program under tests/corpus/ must behave exactly like Node (all
// effects) or be rejected with a CS code. A divergence or a crash fails the build unless the
// program carries `// @known-bug:`, in which case it must STILL fail (so a fix is noticed).
// CHAD_CORPUS=<substring> narrows the run to matching paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import ts from "typescript";
import {
  CORPUS_ROOT,
  categoryOf,
  corpusFailure,
  corpusPrograms,
  runCorpus,
} from "../harness/corpus.js";

const only = process.env["CHAD_CORPUS"];

// A CS0001 rejection only means something if the program is valid TypeScript to begin with:
// every corpus program must typecheck against the real Node types under ChadScript's strictness
// (tests/corpus/tsconfig.json), so a typo in the corpus cannot pass as "rejected cleanly".
test("corpus programs are valid TypeScript against @types/node", () => {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) =>
      assert.fail(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
  };
  const config = ts.getParsedCommandLineOfConfigFile(join(CORPUS_ROOT, "tsconfig.json"), {}, host);
  assert.ok(
    config && config.fileNames.length > 0,
    "no corpus files found by tests/corpus/tsconfig.json",
  );
  const program = ts.createProgram(config.fileNames, config.options);
  const diags = ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file
      ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}`
      : "";
    return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
  assert.deepEqual(diags, []);
});

test("every corpus program declares its category", () => {
  for (const p of corpusPrograms()) assert.match(categoryOf(p.path), /^[a-z-]+$/);
});

test("corpus (realistic programs vs Node, all effects)", { timeout: 900_000 }, async () => {
  const programs = corpusPrograms().filter((p) => only === undefined || p.path.includes(only));
  assert.ok(programs.length > 0, `no corpus programs matched${only ? ` CHAD_CORPUS=${only}` : ""}`);
  const results = await runCorpus(programs);
  const failures = results.map(corpusFailure).filter((f): f is string => f !== null);
  assert.equal(failures.length, 0, `\n${failures.join("\n")}`);
});
