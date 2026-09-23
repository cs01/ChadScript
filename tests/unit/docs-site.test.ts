// Keeps the documentation site honest without running the compiler (fast lane):
//  - docs/reference/errors.md is exactly what docs/scripts/errors.ts generates, and every code in
//    src/validate/codes.ts has a hand-written explanation (no more, no fewer);
//  - the subset page embeds the generated docs/SUBSET.md (whose drift test is subset-doc.test.ts);
//  - pages embed code only from docs/examples/ (`<<< @/examples/...`), every embedded file exists,
//    and every example is shown somewhere. tests/slow/docs-examples.test.ts runs them vs Node.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE } from "../../src/validate/codes.js";
import { EXPLANATIONS, generateErrorsMarkdown } from "../../docs/scripts/errors.js";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");

function* walk(dir: string, skip: ReadonlySet<string>): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (skip.has(e)) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) yield* walk(full, skip);
    else yield full;
  }
}

test("docs/reference/errors.md matches generated output (run `bun run docs/scripts/errors.ts`)", () => {
  const onDisk = readFileSync(join(docs, "reference", "errors.md"), "utf8");
  assert.equal(
    onDisk,
    generateErrorsMarkdown(),
    "docs/reference/errors.md is stale; regenerate it",
  );
});

test("every validator code has exactly one explanation", () => {
  assert.deepEqual(Object.keys(EXPLANATIONS).sort(), Object.keys(CODE).sort());
  const page = generateErrorsMarkdown();
  for (const code of Object.values(CODE)) {
    assert.ok(page.includes(`{#${code.toLowerCase()}}`), `${code} has no section on the page`);
  }
});

// "reserved" on the page must mean exactly "no compiler source outside the code table emits it".
test("codes documented as reserved are the ones nothing emits", () => {
  const src = join(docs, "..", "src");
  const sources = [...walk(src, new Set())]
    .filter((p) => p.endsWith(".ts") && !p.endsWith(join("validate", "codes.ts")))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  for (const [name, code] of Object.entries(CODE)) {
    const emitted = sources.includes(`CODE.${name}`) || sources.includes(`"${code}"`);
    const reserved = EXPLANATIONS[name as keyof typeof CODE].reserved === true;
    assert.equal(
      reserved,
      !emitted,
      `${code} (${name}): reserved=${reserved} but emitted=${emitted}`,
    );
  }
});

test("the subset page embeds the generated SUBSET.md", () => {
  const page = readFileSync(join(docs, "reference", "subset.md"), "utf8");
  assert.ok(
    page.includes("<!--@include: ../SUBSET.md{3,}-->"),
    "reference/subset.md must include SUBSET.md",
  );
  // `{3,}` skips the generated-file comment and SUBSET.md's own title; the page has its own.
  const [comment, title] = readFileSync(join(docs, "SUBSET.md"), "utf8").split("\n");
  assert.ok(
    comment?.startsWith("<!--") && title?.startsWith("# "),
    "SUBSET.md header layout changed",
  );
});

test("pages embed only existing docs examples, and every example is shown", () => {
  const skip = new Set(["node_modules", ".vitepress", "examples", "generated", "scripts"]);
  const pages = [...walk(docs, skip)].filter((p) => p.endsWith(".md"));
  const embedded = new Set<string>();
  for (const page of pages) {
    for (const m of readFileSync(page, "utf8").matchAll(/^<<< @\/(\S+?)(?:\{[^}]*\})?(?:\s|$)/gm)) {
      const target = m[1]!;
      assert.ok(
        target.startsWith("examples/"),
        `${relative(docs, page)} embeds ${target} outside docs/examples`,
      );
      assert.ok(existsSync(join(docs, target)), `${relative(docs, page)} embeds missing ${target}`);
      embedded.add(target);
    }
  }
  const examples = [...walk(join(docs, "examples"), new Set())].map((p) => relative(docs, p));
  assert.ok(examples.length > 0, "no docs examples found");
  const unshown = examples.filter((e) => !embedded.has(e));
  assert.deepEqual(unshown, [], "docs examples not shown on any page");
});
