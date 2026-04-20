// Central IR-operand emission helpers.
//
// Codegen sites across the compiler each build raw LLVM operand strings by
// hand: `@${mangle(name)}`, `%${temp}`, `i8* ${value}`. Scattered call sites
// drift — some forget to mangle user names, some use the wrong sigil, some
// stringify types inconsistently. Every concrete bug in that class (see
// PRs #545/#547/#548/#550, ladder task #11) reduces to "one of the string
// templates was wrong".
//
// This module centralizes the three primitive shapes:
//
//   symbolRef(name, sigil) -> "@_cs_foo"   or "%tmp"
//   operand(type, value)   -> "type value" — the canonical bound form LLVM
//                             expects in call args, GEP bases, phi operands, …
//
// For user-named globals, prefer userGlobalRef(ctx, name) which delegates to
// the context's mangleUserName so the rule for when to prefix (_cs_) lives
// in one place. Raw (already-formed) symbol strings stay as-is — this module
// never double-mangles.

export type SymbolSigil = "@" | "%";

interface ManglerContext {
  mangleUserName(name: string): string;
}

// Produce a correctly-sigiled reference to a symbol. `name` is the *unsigiled*
// symbol name — do NOT pass pre-prefixed "@foo" or "%tmp".
export function symbolRef(name: string, sigil: SymbolSigil): string {
  if (name.length === 0) {
    throw new Error("symbolRef: empty symbol name");
  }
  if (name[0] === "@" || name[0] === "%") {
    throw new Error(`symbolRef: name already sigiled: ${name}`);
  }
  return `${sigil}${name}`;
}

// Produce a global reference for a *user-declared* identifier (function,
// global variable). Uses the context's mangleUserName to pick up the _cs_
// prefix rule. Pass the raw user identifier, not pre-mangled.
export function userGlobalRef(ctx: ManglerContext, userName: string): string {
  return symbolRef(ctx.mangleUserName(userName), "@");
}

// Produce a global reference for a *compiler-internal* (already-final) name
// — e.g. "GC_malloc", "http_serve", class/method slot names that the
// compiler constructs itself. Skips the mangler.
export function internalGlobalRef(finalName: string): string {
  return symbolRef(finalName, "@");
}

// Produce a bound operand "type value" — the shape LLVM expects anywhere an
// SSA value appears with its type (call arguments, GEP indices, phi pairs,
// select operands, …). Centralizing this lets future work check that `type`
// is actually a valid LLVM type string without touching every call site.
export function operand(type: string, value: string): string {
  if (type.length === 0) {
    throw new Error("operand: empty type string");
  }
  if (value.length === 0) {
    throw new Error("operand: empty value string");
  }
  return `${type} ${value}`;
}

// Join parallel type/value arrays into a comma-separated argument list —
// saves the ", " + zip boilerplate at call sites. Parallel arrays (rather
// than an Array<[type, value]> tuple) keeps the helper Stage-0-compatible:
// the native self-host compiler does not round-trip tuple element types
// correctly through `for...of` destructuring.
export function operandList(types: string[], values: string[]): string {
  if (types.length !== values.length) {
    throw new Error(
      `operandList: length mismatch (types=${types.length}, values=${values.length})`,
    );
  }
  const parts: string[] = [];
  for (let i = 0; i < types.length; i++) {
    parts.push(operand(types[i], values[i]));
  }
  return parts.join(", ");
}
