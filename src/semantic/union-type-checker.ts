import type { AST, SourceLocation } from "../ast/types.js";
import { tsTypeToLlvm } from "../codegen/infrastructure/type-system.js";

export function checkUnionTypes(ast: AST): void {
  const unsafeAliases: string[] = [];

  if (ast.typeAliases) {
    for (let i = 0; i < ast.typeAliases.length; i++) {
      const alias = ast.typeAliases[i];
      const members = alias.unionMembers;
      if (!members || members.length < 2) continue;

      const llvmTypes: string[] = [];
      for (let j = 0; j < members.length; j++) {
        const m = members[j].trim();
        if (m === "null" || m === "undefined") continue;
        llvmTypes.push(tsTypeToLlvm(m));
      }
      if (llvmTypes.length < 2) continue;

      let hasMixed = false;
      for (let j = 1; j < llvmTypes.length; j++) {
        if (llvmTypes[j] !== llvmTypes[0]) {
          hasMixed = true;
          break;
        }
      }
      if (hasMixed) {
        unsafeAliases.push(alias.name);
      }
    }
  }

  function isUnsafeAlias(typeName: string): boolean {
    let name = typeName;
    if (name.endsWith("[]")) {
      name = name.substring(0, name.length - 2);
    }
    return unsafeAliases.indexOf(name) !== -1;
  }

  function checkParams(
    funcName: string,
    paramTypes: string[] | undefined,
    locHolder: { loc?: SourceLocation },
  ): void {
    if (!paramTypes) return;
    for (let i = 0; i < paramTypes.length; i++) {
      if (isUnsafeAlias(paramTypes[i])) {
        reportError(funcName, paramTypes[i], locHolder.loc);
      }
    }
  }

  function reportError(funcName: string, aliasName: string, loc: SourceLocation | undefined): void {
    let msg = "";
    if (loc !== null && loc !== undefined) {
      const file = loc.file || "<input>";
      msg +=
        file +
        ":" +
        loc.line +
        ":" +
        (loc.column + 1) +
        ": error: in function '" +
        funcName +
        "', parameter type '" +
        aliasName +
        "' is a union type alias with mixed representations\n";
    } else {
      msg +=
        "error: in function '" +
        funcName +
        "', parameter type '" +
        aliasName +
        "' is a union type alias with mixed representations\n";
    }
    msg +=
      "  note: '" +
      aliasName +
      "' is a type alias for a union whose members have different native types (e.g., i8* vs double)\n";
    msg +=
      "  note: this will be miscompiled and segfault at runtime. Use a common base interface or separate the types.\n";
    console.error(msg);
    process.exit(1);
  }

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    if (fn.declare) continue;
    checkParams(fn.name, fn.paramTypes, fn as { loc?: SourceLocation });
  }

  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) {
      const method = cls.methods[j];
      const qualName = cls.name + "." + method.name;
      checkParams(qualName, method.paramTypes, method as { loc?: SourceLocation });
    }
  }
}
