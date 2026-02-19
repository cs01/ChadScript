## Fix try/catch tests, JSON.parse on macOS, and require native compiler in test suite

### Summary

- Flatten `TryStatement` AST node back to direct fields (`catchParam`, `catchBody`) instead of nested `catchClause: { param, body }` — fixes a self-hosting bug where the native compiler couldn't handle chained inline struct field access (`tryStmt.catchClause.body`), causing catch block bodies to be silently dropped from generated IR
- Eliminate array-of-objects pattern in `json.ts` JSON.parse codegen — fixes a self-hosting crash on macOS ARM64 where the native compiler segfaulted when compiling `JSON.parse<T>()` calls
- Make `npm test` build `.build/chadc` automatically if missing, and fail loudly instead of silently falling back to the Node.js interpreter

### Problem

1. **Try/catch self-hosting bug**: Commit 5271d53 changed `TryStatement` from flat fields to a nested struct, relying on inline struct field access working in the native compiler. The two-level chained access `tryStmt.catchClause.body` silently produced no code in the native binary, so catch blocks were completely empty in the generated LLVM IR.

2. **JSON.parse crash on macOS**: `json.ts` used a `JsonInterfaceDef` intermediate type containing `{ name: string; type: string }[]` (array-of-objects). The native compiler can't reliably handle this pattern — it produces undefined behavior that crashes on macOS ARM64 (strict alignment/memory protection) while accidentally working on Linux x86_64. The fix requirement was surfaced by the test infrastructure change forcing CI to use the native compiler.

3. **Silent test fallback**: `compiler.test.ts` fell back to `node dist/chadc-node.js` if `.build/chadc` was missing. CI never had the native binary, so it always tested with the Node.js interpreter, masking both bugs above.

### Changes

- `src/ast/types.ts` — `TryStatement` uses `catchParam: string | null` + `catchBody: BlockStatement | null` instead of `catchClause: { param, body } | null`
- `src/codegen/statements/control-flow.ts` — access flat fields in codegen
- `src/parser-native/transformer.ts` — produce flat fields from tree-sitter parse
- `src/parser-ts/handlers/statements.ts` — produce flat fields from TS API parse
- `src/analysis/semantic-analyzer.ts` — access flat fields
- `src/ast/visitor.ts` — access flat fields
- `src/codegen/infrastructure/closure-analyzer.ts` — access flat fields
- `src/codegen/stdlib/json.ts` — remove `JsonInterfaceDef` and `getInterfaceFields()`, use delegate methods (`interfaceStructGenGetFieldCount`, `interfaceStructGenGetFieldName`, `interfaceStructGenGetFieldTsType`) directly instead of building an intermediate array-of-objects
- `scripts/test.js` — build native compiler before running tests
- `tests/compiler.test.ts` — require `.build/chadc`, error if missing

### Test plan

- [x] `npm test` — 299/299 passing (was 291/298)
- [x] `npm run verify:quick` — self-hosting passes
- [x] All 3 try/catch fixtures produce correct output with native compiler
- [x] All 3 JSON.parse fixtures compile and run correctly with native compiler
- [x] JSON.stringify still works (no regression)
- [x] Missing `.build/chadc` now throws a clear error instead of silent fallback
