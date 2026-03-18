import type { AST, SourceLocation } from "../ast/types.js";
import { tsTypeToLlvm } from "../codegen/infrastructure/type-system.js";
import { formatCompileError } from "../diagnostics/engine.js";

function buildUnsafeAliases(ast: AST): string[] {
  const unsafeAliases: string[] = [];
  if (!ast.typeAliases) return unsafeAliases;
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
  return unsafeAliases;
}

function isUnsafeAlias(unsafeAliases: string[], typeName: string): boolean {
  let name = typeName;
  if (name.endsWith("[]")) {
    name = name.substring(0, name.length - 2);
  }
  return unsafeAliases.indexOf(name) !== -1;
}

function reportUnionError(
  sourceCode: string,
  funcName: string,
  aliasName: string,
  loc: SourceLocation | undefined,
): void {
  const output = formatCompileError(
    sourceCode,
    "in function '" +
      funcName +
      "', parameter type '" +
      aliasName +
      "' is a union type alias with mixed representations",
    loc,
    "use a common base interface or separate the types",
    [
      "'" +
        aliasName +
        "' is a type alias for a union whose members have different native types (e.g., i8* vs double)",
    ],
  );
  process.stderr.write(output);
  process.exit(1);
}

function reportFieldUnionError(
  sourceCode: string,
  context: string,
  fieldName: string,
  aliasName: string,
  loc: SourceLocation | undefined,
): void {
  const output = formatCompileError(
    sourceCode,
    "in " +
      context +
      ", field '" +
      fieldName +
      "' has type '" +
      aliasName +
      "' which is a union type alias with mixed representations",
    loc,
    "use a common base interface or separate the types",
    [
      "'" +
        aliasName +
        "' is a type alias for a union whose members have different native types (e.g., i8* vs double)",
    ],
  );
  process.stderr.write(output);
  process.exit(1);
}

export function checkUnionTypes(ast: AST, sourceCode: string): void {
  const unsafeAliases = buildUnsafeAliases(ast);

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    if (fn.declare) continue;
    const paramTypes = fn.paramTypes;
    if (!paramTypes) continue;
    const locHolder = fn as { loc?: SourceLocation };
    for (let j = 0; j < paramTypes.length; j++) {
      if (isUnsafeAlias(unsafeAliases, paramTypes[j])) {
        reportUnionError(sourceCode, fn.name, paramTypes[j], locHolder.loc);
      }
    }
  }

  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let k = 0; k < cls.methods.length; k++) {
      const method = cls.methods[k];
      const qualName = cls.name + "." + method.name;
      const paramTypes = method.paramTypes;
      if (!paramTypes) continue;
      const locHolder = method as { loc?: SourceLocation };
      for (let j = 0; j < paramTypes.length; j++) {
        if (isUnsafeAlias(unsafeAliases, paramTypes[j])) {
          reportUnionError(sourceCode, qualName, paramTypes[j], locHolder.loc);
        }
      }
    }
    for (let k = 0; k < cls.fields.length; k++) {
      const field = cls.fields[k];
      if (field.tsType && isUnsafeAlias(unsafeAliases, field.tsType)) {
        const locHolder = cls as { loc?: SourceLocation };
        reportFieldUnionError(
          sourceCode,
          "class '" + cls.name + "'",
          field.name,
          field.tsType,
          locHolder.loc,
        );
      }
    }
  }

  for (let i = 0; i < ast.interfaces.length; i++) {
    const iface = ast.interfaces[i];
    for (let j = 0; j < iface.fields.length; j++) {
      const field = iface.fields[j];
      if (isUnsafeAlias(unsafeAliases, field.type)) {
        reportFieldUnionError(
          sourceCode,
          "interface '" + iface.name + "'",
          field.name,
          field.type,
          undefined,
        );
      }
    }
  }
}
