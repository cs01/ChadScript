import { describe, it } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverTests } from "./test-discovery.js";
import { parseWithTSAPI } from "../src/parser-ts/index.js";
import type {
  AST,
  ImportDeclaration,
  FunctionNode,
  ClassNode,
  ClassMethod,
} from "../src/ast/types.js";

const hasNative = fs.existsSync(".build/chad");

// Extract the same structural summary produced by the native ast-dump command.
// Both sides must emit identical JSON for the parity check to be meaningful.
function extractSummary(ast: AST): unknown {
  return {
    imports: ast.imports.map((imp: ImportDeclaration) => ({
      source: imp.source,
      specifiers: imp.specifiers,
    })),
    functions: ast.functions.map((fn: FunctionNode) => ({
      name: fn.name,
      params: fn.params,
    })),
    classes: ast.classes.map((cls: ClassNode) => ({
      name: cls.name,
      methods: cls.methods.map((m: ClassMethod) => m.name),
    })),
  };
}

const cases = discoverTests().filter((tc) => !tc.compileError);

describe("Parser parity (TS vs native)", { skip: !hasNative }, () => {
  describe("Structural AST equivalence", { concurrency: 16 }, () => {
    for (const tc of cases) {
      it(tc.description, () => {
        const fixturePath = path.resolve(tc.fixture);
        const code = fs.readFileSync(fixturePath, "utf8");

        const jsAst = parseWithTSAPI(code, { filename: tc.fixture });
        const jsSummary = extractSummary(jsAst);

        let nativeOut: string;
        try {
          nativeOut = execSync(`.build/chad ast-dump ${tc.fixture}`, { encoding: "utf8" });
        } catch (e: any) {
          throw new Error(`Native ast-dump failed for ${tc.fixture}: ${e.stderr ?? e.message}`);
        }
        const nativeSummary = JSON.parse(nativeOut);

        assert.deepStrictEqual(nativeSummary, jsSummary, `Parser divergence in ${tc.fixture}`);
      });
    }
  });
});
