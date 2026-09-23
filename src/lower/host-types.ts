// Host handles: the runtime objects the network APIs hand out (a `net.Server`, a `net.Socket`, a
// received `Buffer`). Each is declared in stdlib/globals.d.ts as a branded interface and is, in
// the value domain, an opaque pointer to a runtime struct: its declared members are its whole API,
// lowered one by one to runtime calls (host-api.ts). Recognition is by declaring file plus name, so
// a program's own `Socket` interface stays an ordinary object type.
//
// Shared by lowering (type translation, member lowering) and the validator (which admits member
// access on these types and nothing else), so the two agree on what a host handle is.

import ts from "typescript";

// Qualified names: `<module>.<name>` for a type declared in `declare module "node:<module>"`, the
// bare name for a global one.
export const HOST_TYPES: ReadonlySet<string> = new Set([
  "Buffer",
  "net.Server",
  "net.Socket",
  "net.AddressInfo",
]);

function isGlobalsFile(sf: ts.SourceFile): boolean {
  return sf.fileName.endsWith("stdlib/globals.d.ts");
}

// The `node:<module>` an ambient declaration sits in, without the `node:` prefix, or null.
export function ambientModuleOf(decl: ts.Node): string | null {
  for (let n: ts.Node | undefined = decl.parent; n; n = n.parent) {
    if (ts.isModuleDeclaration(n) && ts.isStringLiteral(n.name)) {
      const text = n.name.text;
      return text.startsWith("node:") ? text.slice("node:".length) : text;
    }
  }
  return null;
}

// The qualified name of the declaration `decl` names, when it is declared in the ambient
// environment.
export function qualifiedAmbientName(decl: ts.Declaration, name: string): string | null {
  if (!isGlobalsFile(decl.getSourceFile())) return null;
  const mod = ambientModuleOf(decl);
  return mod === null ? name : `${mod}.${name}`;
}

// The host handle type `t` is, or null.
export function hostTypeName(t: ts.Type): string | null {
  const sym = t.getSymbol() ?? t.aliasSymbol;
  const decl = sym?.declarations?.[0];
  if (!sym || !decl) return null;
  const q = qualifiedAmbientName(decl, sym.getName());
  return q !== null && HOST_TYPES.has(q) ? q : null;
}

// `SystemError` (globals.d.ts): an Error that also has a `code`.
export function isSystemErrorType(t: ts.Type): boolean {
  const sym = t.getSymbol();
  const decl = sym?.declarations?.[0];
  return (
    sym !== undefined &&
    decl !== undefined &&
    sym.getName() === "SystemError" &&
    isGlobalsFile(decl.getSourceFile())
  );
}

// The brand members (`__opaqueSocket`) exist only to stop a program from building a look-alike
// object literal; they are not readable.
export function isBrandMember(name: string): boolean {
  return name.startsWith("__opaque");
}
