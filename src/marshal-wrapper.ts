// Cross-boundary export marshal.
//
// When a native ChadScript file imports from another `.ts` that has
// `// @chadscript: interpret` at the top, the imported file's source runs
// under Node. The importer wants to call the exported functions naturally —
// `import { ms } from './pragma-file'` followed by `ms("2 days")` — without
// writing any JSHandle FFI by hand.
//
// This module synthesizes a replacement `.ts` wrapper for the pragma file.
// The wrapper has the same exported function signatures as the original but
// each body calls into the libnode JSHandle bridge: one bootstrap step evals
// the pragma source inside Node and captures its module.exports as a handle;
// each call marshals args per declared types, invokes cs_v8_callN, and
// unmarshals the result per declared return type.

import { parseWithTSAPI } from "./parser-ts/index.js";
import { FunctionNode } from "./ast/types.js";

// Mirrors detectInterpretPragma in compiler.ts (kept local to avoid import cycle).
export function hasInterpretPragma(source: string): boolean {
  const lines = source.split("\n", 10);
  for (const line of lines) {
    if (/^\s*\/\/\s*@chadscript\s*:\s*interpret\b/.test(line)) return true;
  }
  return false;
}

const EXTERN_DECLS =
  `declare function cs_v8_register_pragma_module(src: string, file: string): number;\n` +
  `declare function cs_v8_handle_get_property(obj: number, name: string): number;\n` +
  `declare function cs_v8_make_string_handle(s: string): number;\n` +
  `declare function cs_v8_make_number_handle(n: number): number;\n` +
  `declare function cs_v8_make_bool_handle(b: number): number;\n` +
  `declare function cs_v8_handle_to_string(h: number): string;\n` +
  `declare function cs_v8_handle_to_number(h: number): number;\n` +
  `declare function cs_v8_handle_to_bool(h: number): number;\n` +
  `declare function cs_v8_handle_release(h: number): void;\n` +
  `declare function cs_v8_last_error(): string;\n` +
  `declare function cs_v8_call0(fn: number, recv: number): number;\n` +
  `declare function cs_v8_call1(fn: number, recv: number, a0: number): number;\n` +
  `declare function cs_v8_call2(fn: number, recv: number, a0: number, a1: number): number;\n` +
  `declare function cs_v8_call3(fn: number, recv: number, a0: number, a1: number, a2: number): number;\n` +
  `declare function cs_v8_call4(fn: number, recv: number, a0: number, a1: number, a2: number, a3: number): number;\n` +
  `declare function cs_v8_call5(fn: number, recv: number, a0: number, a1: number, a2: number, a3: number, a4: number): number;\n` +
  `declare function cs_v8_call6(fn: number, recv: number, a0: number, a1: number, a2: number, a3: number, a4: number, a5: number): number;\n` +
  `declare function cs_v8_call7(fn: number, recv: number, a0: number, a1: number, a2: number, a3: number, a4: number, a5: number, a6: number): number;\n` +
  `declare function cs_v8_call8(fn: number, recv: number, a0: number, a1: number, a2: number, a3: number, a4: number, a5: number, a6: number, a7: number): number;\n` +
  `declare function cs_v8_handle_await(h: number): number;\n`;

// Turn an absolute filesystem path into a sanitized identifier-safe suffix
// used to disambiguate globals across multiple imported pragma modules.
function moduleSlug(absPath: string): string {
  let h = 0;
  for (let i = 0; i < absPath.length; i++) {
    h = (h * 31 + absPath.charCodeAt(i)) | 0;
  }
  const base = absPath
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]*$/, "")
    .replace(/[^a-zA-Z0-9_]/g, "_");
  const hex = (h >>> 0).toString(16);
  return `${base}_${hex}`;
}

// Return the TS expression that marshals `varName` (typed `tsType`) into a
// JSHandle `number`. Primitive fast-path; anything else is assumed to already
// be a handle (number).
function marshalArg(varName: string, tsType: string | undefined): string {
  const t = (tsType || "").trim();
  if (t === "string") return `cs_v8_make_string_handle(${varName})`;
  if (t === "number") return `cs_v8_make_number_handle(${varName})`;
  if (t === "boolean") return `cs_v8_make_bool_handle(${varName} ? 1 : 0)`;
  // Fallback: assume the caller passed a JSHandle (number) already. Future
  // work: objects, arrays, class instances.
  return varName;
}

// Return TS that unmarshals `handleVar` (JSHandle) into a value typed `tsType`.
// Uses a temporary `const` so we can release the handle before returning.
function unmarshalResult(
  handleVar: string,
  tsType: string | undefined,
): {
  body: string;
  returnExpr: string;
} {
  const t = (tsType || "").trim();
  if (t === "" || t === "void") {
    return { body: `cs_v8_handle_release(${handleVar});\n`, returnExpr: "" };
  }
  if (t === "string") {
    return {
      body: `const __out_val: string = cs_v8_handle_to_string(${handleVar});\ncs_v8_handle_release(${handleVar});\n`,
      returnExpr: "__out_val",
    };
  }
  if (t === "number") {
    return {
      body: `const __out_val: number = cs_v8_handle_to_number(${handleVar});\ncs_v8_handle_release(${handleVar});\n`,
      returnExpr: "__out_val",
    };
  }
  if (t === "boolean") {
    return {
      body: `const __out_val: number = cs_v8_handle_to_bool(${handleVar});\n// retain handle; callers asked for bool\ncs_v8_handle_release(${handleVar});\n`,
      returnExpr: "__out_val !== 0",
    };
  }
  // Anything else: return the handle itself (caller sees a `number`).
  return { body: "", returnExpr: handleVar };
}

// Build the wrapper for one exported function.
function buildFunctionWrapper(fn: FunctionNode, slug: string, moduleName: string): string | null {
  const arity = fn.params.length;
  if (arity > 8) {
    return (
      `// marshal: skipping export '${fn.name}' — arity ${arity} exceeds max 8. ` +
      `Add cs_v8_call${arity} to node-bridge.cc to enable.\n`
    );
  }
  const paramTypes = fn.paramTypes || [];
  const paramDecls: string[] = [];
  for (let i = 0; i < arity; i++) {
    const p = fn.params[i];
    const t = paramTypes[i] || "number";
    paramDecls.push(`${p}: ${t}`);
  }
  const ret = (fn.returnType || "void").trim();
  const exportKw = "export ";
  // Unwrap Promise<T>: the JS-side call returns a Promise handle, then we
  // spin the event loop via cs_v8_handle_await to resolve it. Native side
  // sees a synchronous T — avoids plumbing JS promise identity through the
  // native async/await machinery.
  let effectiveRet = ret;
  let isAsync = false;
  const promiseMatch = /^Promise\s*<\s*(.+)\s*>$/.exec(ret);
  if (promiseMatch) {
    effectiveRet = promiseMatch[1].trim();
    isAsync = true;
  }

  const argMarshals: string[] = [];
  for (let i = 0; i < arity; i++) {
    argMarshals.push(`const __a${i}: number = ${marshalArg(fn.params[i], paramTypes[i])};`);
  }

  const callArgs: string[] = ["__fn_" + fn.name, "0"];
  for (let i = 0; i < arity; i++) callArgs.push(`__a${i}`);
  const callExpr = `cs_v8_call${arity}(${callArgs.join(", ")})`;
  const postCall = isAsync
    ? `const __res_raw: number = ${callExpr};\n  const __res: number = cs_v8_handle_await(__res_raw);\n  cs_v8_handle_release(__res_raw);`
    : `const __res: number = ${callExpr};`;

  const unm = unmarshalResult("__res", effectiveRet);

  // Release arg handles after the call (cleanup). Skip releasing pass-through
  // handles (when param type is a JSHandle number — releasing would pull the
  // rug from a caller who still holds the handle).
  const argReleases: string[] = [];
  for (let i = 0; i < arity; i++) {
    const t = (paramTypes[i] || "").trim();
    if (t === "string" || t === "number" || t === "boolean") {
      argReleases.push(`cs_v8_handle_release(__a${i});`);
    }
  }

  const retKw = effectiveRet === "" || effectiveRet === "void" ? "void" : effectiveRet;
  const retStmt = unm.returnExpr === "" ? "" : `return ${unm.returnExpr};\n`;
  // Preserve async declaration so native callers can `await` the returned
  // value. The body runs synchronously (via handle_await's SpinEventLoop),
  // but TypeScript's async-function wrapping makes the return a Promise<T>.
  const asyncKw = isAsync ? "async " : "";
  const sigRet = isAsync ? `Promise<${retKw}>` : retKw;

  return (
    `${exportKw}${asyncKw}function ${fn.name}(${paramDecls.join(", ")}): ${sigRet} {\n` +
    `  const __mod: number = __marshal_ensure_${slug}();\n` +
    `  const __fn_${fn.name}: number = cs_v8_handle_get_property(__mod, "${fn.name}");\n` +
    `  ${argMarshals.join("\n  ")}\n` +
    `  ${postCall}\n` +
    `  const __err: string = cs_v8_last_error();\n` +
    `  if (__err.length > 0) {\n` +
    `    console.log("marshal: call to ${fn.name} in ${moduleName} failed: " + __err);\n` +
    `    process.exit(1);\n` +
    `  }\n` +
    `  ${argReleases.join("\n  ")}\n` +
    `  cs_v8_handle_release(__fn_${fn.name});\n` +
    `  ${unm.body}` +
    `  ${retStmt}` +
    `}\n`
  );
}

// Escape a string for embedding as a TS string literal inside double quotes.
function tsStringLit(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x5c /* \ */) out += "\\\\";
    else if (c === 0x22 /* " */) out += '\\"';
    else if (c === 0x0a /* \n */) out += "\\n";
    else if (c === 0x0d /* \r */) out += "\\r";
    else if (c === 0x09 /* \t */) out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += s[i];
  }
  out += '"';
  return out;
}

// Rewrite `export function foo` / `export async function foo` / `export const foo =`
// into CJS-compatible `module.exports.foo = ...` form. Our pragma wrapper in
// node-bridge.cc runs the source inside a synthetic CJS function body where
// ES-module `export` is a syntax error. TS types are stripped by the fact that
// Node sees this source only after we also strip `: Type` annotations.
function rewriteExportsForCJS(src: string): string {
  // Strip TS type annotations on exported function parameters and return type.
  // Pragma files are limited in scope — this covers the 90% case. Future work:
  // use the TS parser to do a proper lowering.
  let out = src;
  // export async function name(params): ret { → module.exports.name = async function(params){
  out = out.replace(
    /\bexport\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*[^({]+)?\s*\{/g,
    (_m, name, params) => `module.exports.${name} = async function(${stripParamTypes(params)}){`,
  );
  out = out.replace(
    /\bexport\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*[^({]+)?\s*\{/g,
    (_m, name, params) => `module.exports.${name} = function(${stripParamTypes(params)}){`,
  );
  // export const name = ...  → module.exports.name = ...
  out = out.replace(
    /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?\s*=/g,
    (_m, name) => `module.exports.${name} =`,
  );
  return out;
}

function stripParamTypes(params: string): string {
  // For each top-level comma-separated parameter, drop `: Type` suffix but keep
  // defaults. Shallow split — doesn't handle `foo: {a: b}` object-type
  // annotations (unusual in hand-written pragma files).
  const parts = params.split(",");
  const cleaned: string[] = [];
  for (const p of parts) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    const eq = trimmed.indexOf("=");
    if (colon >= 0 && (eq < 0 || colon < eq)) {
      const name = trimmed.substring(0, colon).trim();
      if (eq > colon) {
        cleaned.push(`${name} ${trimmed.substring(eq)}`);
      } else {
        cleaned.push(name);
      }
    } else {
      cleaned.push(trimmed);
    }
  }
  return cleaned.join(", ");
}

// Build the full wrapper `.ts` source replacing a pragma file from the
// native side's perspective. Returns a complete, standalone TS module.
export function buildMarshalWrapper(absPath: string, pragmaSource: string): string {
  const slug = moduleSlug(absPath);
  const ast = parseWithTSAPI(pragmaSource, { filename: absPath });
  const jsSource = rewriteExportsForCJS(pragmaSource);

  // Collect exported function declarations. `ast.exports` holds ExportDeclaration
  // for `export function foo`; we also include top-level functions flagged as
  // exported (the parser already adds them to exports).
  const exportedFns: FunctionNode[] = [];
  for (const exp of ast.exports) {
    if (exp.declaration && (exp.declaration as FunctionNode).params !== undefined) {
      exportedFns.push(exp.declaration as FunctionNode);
    }
  }

  const parts: string[] = [];
  parts.push("// Auto-generated marshal wrapper for: " + absPath);
  parts.push(EXTERN_DECLS);
  parts.push(`let __marshal_exports_${slug}: number = 0;`);
  parts.push(`function __marshal_ensure_${slug}(): number {`);
  parts.push(`  if (__marshal_exports_${slug} !== 0) return __marshal_exports_${slug};`);
  parts.push(`  const __src: string = ${tsStringLit(jsSource)};`);
  parts.push(`  const __file: string = ${tsStringLit(absPath)};`);
  parts.push(`  __marshal_exports_${slug} = cs_v8_register_pragma_module(__src, __file);`);
  parts.push(`  const __err: string = cs_v8_last_error();`);
  parts.push(`  if (__err.length > 0) {`);
  parts.push(
    `    console.log("marshal: failed to load pragma module ${absPath.replace(/\\/g, "/").replace(/"/g, '\\"')}: " + __err);`,
  );
  parts.push(`    process.exit(1);`);
  parts.push(`  }`);
  parts.push(`  return __marshal_exports_${slug};`);
  parts.push(`}`);

  for (const fn of exportedFns) {
    const w = buildFunctionWrapper(fn, slug, absPath);
    if (w) parts.push(w);
  }

  return parts.join("\n") + "\n";
}
