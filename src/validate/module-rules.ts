// Validator rules for the module surface: which modules an import may name, which export forms
// are admitted, and where a module namespace may appear.
//
// Every import and export form is name resolution that tsc has already done, so none of them needs
// runtime machinery: bindings are keyed by their resolved symbol, a namespace member `m.x` is a
// static reference (lower/module-refs.ts), and a default export is either an alias or one
// module-level constant (lower/default-export.ts). What is rejected here is what has NO such
// static meaning: a module whose code we do not have, a namespace used as a value, and default
// exports whose alias semantics would differ from Node's value semantics.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";
import { NODE_FS_MODULE } from "../lower/node-fs.js";
import { NODE_PATH_MODULE } from "../lower/node-path.js";
import { NODE_FS_PROMISES_MODULE } from "../lower/node-fs-promises.js";
import { namespaceModuleOf } from "../lower/module-refs.js";
import { PACKAGE_WITHOUT_SOURCE_HINT } from "../frontend/module-diagnostics.js";

// The builtin modules the runtime implements. Their ambient declarations in stdlib/globals.d.ts
// are the allowlist of names; importing anything else from them fails at typecheck (CS0001).
const BUILTIN_MODULES: ReadonlySet<string> = new Set([
  NODE_FS_MODULE,
  NODE_PATH_MODULE,
  NODE_FS_PROMISES_MODULE,
  // The network modules; lower/host-api.ts lowers their members.
  "node:net",
]);

function isOurAmbientDeclaration(decl: ts.Node): boolean {
  return decl.getSourceFile().fileName.endsWith("stdlib/globals.d.ts");
}

// The module a specifier resolves to (via tsc) must be one we can compile: TypeScript source
// (user code, or a package shipped as `.ts`), or a builtin the runtime implements.
function checkModuleTarget(
  spec: ts.Expression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  if (!ts.isStringLiteral(spec)) {
    return hit(
      CODE.MODULE_FORM,
      "a module specifier must be a string literal",
      'use `import { x } from "./file"`',
    );
  }
  const target = checker.getSymbolAtLocation(spec)?.declarations?.[0];
  if (target && ts.isSourceFile(target) && !target.isDeclarationFile) return null;
  if (
    target &&
    ts.isModuleDeclaration(target) &&
    BUILTIN_MODULES.has(spec.text) &&
    isOurAmbientDeclaration(target)
  ) {
    return null;
  }
  return hit(
    CODE.MODULE_FORM,
    `module \`${spec.text}\` has no TypeScript source (it resolves to declarations only)`,
    PACKAGE_WITHOUT_SOURCE_HINT,
  );
}

export function checkImport(
  node: ts.ImportDeclaration,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  // `import type` is erased: it names no runtime module, so any declaration file may supply it.
  if (node.importClause?.isTypeOnly) return null;
  return checkModuleTarget(node.moduleSpecifier, hit, checker);
}

export function checkExportDeclaration(
  node: ts.ExportDeclaration,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
    return hit(
      CODE.MODULE_FORM,
      "`export * as ns from` is not supported: it exports a module namespace as a value",
      'export the bindings themselves (`export * from "./m"`), and import them by name',
    );
  }
  if (!node.moduleSpecifier || node.isTypeOnly) return null;
  return checkModuleTarget(node.moduleSpecifier, hit, checker);
}

// `export default <expression>`. Per the spec it exports the expression's VALUE at that moment;
// tsc (and so lowering) treats an identifier or property-access operand as an ALIAS of that
// binding instead. The two agree only when the binding can never change, so a `let` or a property
// access is rejected, and every other expression becomes a module-level constant.
export function checkExportAssignment(
  node: ts.ExportAssignment,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  if (node.isExportEquals) {
    return hit(
      CODE.MODULE_FORM,
      "`export =` (CommonJS) is not supported",
      "use `export default ...` or named exports",
    );
  }
  const e = node.expression;
  if (ts.isPropertyAccessExpression(e)) {
    return hit(
      CODE.MODULE_FORM,
      "`export default` of a property access is not supported",
      "bind it to a `const` first and export that: `const v = a.b; export default v;`",
    );
  }
  if (ts.isIdentifier(e)) {
    const sym = checker.getSymbolAtLocation(e);
    const target = sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const decl = target?.valueDeclaration;
    if (
      decl &&
      ts.isVariableDeclaration(decl) &&
      ts.isVariableDeclarationList(decl.parent) &&
      (decl.parent.flags & ts.NodeFlags.Const) === 0
    ) {
      return hit(
        CODE.MODULE_FORM,
        `\`export default ${e.text}\` of a mutable \`let\` is not supported`,
        `it exports the value at this point, not the variable; use \`export { ${e.text} as default }\` ` +
          "for a live binding, or declare it `const`",
      );
    }
  }
  return null;
}

// `export default class {}`: generated code names a class after its source name.
export function checkDefaultClass(node: ts.ClassDeclaration, hit: Hit): Diagnostic | null {
  if (node.name) return null;
  return hit(
    CODE.MODULE_FORM,
    "an anonymous `export default class` is not supported",
    "give the class a name: `export default class Name { ... }`",
  );
}

// A module namespace (`import * as m`, or a builtin's default import) has no runtime object. It
// may only be the left side of a member access (`m.x`, value or type position); anything else
// would need the object.
export function checkNamespaceValue(
  id: ts.Identifier,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const parent = id.parent as ts.Node | undefined;
  if (!parent) return null;
  if (ts.isNamespaceImport(parent) || ts.isImportClause(parent)) return null;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === id) return null;
  if (ts.isQualifiedName(parent) && parent.left === id) return null;
  if (!namespaceModuleOf(id, checker)) return null;
  return hit(
    CODE.MODULE_FORM,
    `the module namespace \`${id.text}\` cannot be used as a value`,
    `a namespace has no runtime object; refer to its members directly (\`${id.text}.name\`) or ` +
      "import the bindings by name",
  );
}
