// Union type checker — semantic pass that rejects unsafe union type aliases
// used as function/method parameter types.
//
// The existing checkUnsafeUnionType (called by SemanticAnalyzer) catches inline
// unions with different LLVM representations (e.g., `string | number`). But type
// alias unions like `type Mixed = string | number` bypass that check because the
// parameter type string is just "Mixed" (no " | " to split on).
//
// This pass resolves type aliases and checks whether their members would map to
// different LLVM types. When they do, the codegen emits the alias name literally
// as the LLVM param type, which defaults to i8* — causing a segfault if the
// caller passes a value with a different representation (e.g., double for number).

import type { AST, SourceLocation } from "../ast/types.js";
import { tsTypeToLlvm } from "../codegen/infrastructure/type-system.js";

export function checkUnionTypes(ast: AST): void {
  const checker = new UnionTypeChecker(ast);
  checker.check();
}

class UnionTypeChecker {
  private ast: AST;
  // Names of type aliases whose union members have different LLVM representations
  private unsafeAliases: string[];

  constructor(ast: AST) {
    this.ast = ast;
    this.unsafeAliases = [];
    this.buildUnsafeAliasIndex();
  }

  // Pre-compute which type alias names resolve to unions with mixed LLVM types.
  private buildUnsafeAliasIndex(): void {
    if (!this.ast.typeAliases) return;
    for (let i = 0; i < this.ast.typeAliases.length; i++) {
      const alias = this.ast.typeAliases[i];
      const members = alias.unionMembers;
      if (!members || members.length < 2) continue;

      // Collect LLVM types for non-null members
      const llvmTypes: string[] = [];
      for (let j = 0; j < members.length; j++) {
        const m = members[j].trim();
        if (m === "null" || m === "undefined") continue;
        llvmTypes.push(tsTypeToLlvm(m));
      }
      if (llvmTypes.length < 2) continue;

      // Check if any member has a different LLVM type than the first
      let hasMixed = false;
      for (let j = 1; j < llvmTypes.length; j++) {
        if (llvmTypes[j] !== llvmTypes[0]) {
          hasMixed = true;
          break;
        }
      }
      if (hasMixed) {
        this.unsafeAliases.push(alias.name);
      }
    }
  }

  private isUnsafeAlias(typeName: string): boolean {
    let name = typeName;
    if (name.endsWith("[]")) {
      name = name.substring(0, name.length - 2);
    }
    return this.unsafeAliases.indexOf(name) !== -1;
  }

  check(): void {
    // Check standalone function parameters
    for (let i = 0; i < this.ast.functions.length; i++) {
      const fn = this.ast.functions[i];
      if (fn.declare) continue;
      this.checkParams(fn.name, fn.paramTypes, fn as { loc?: SourceLocation });
    }

    // Check class method parameters
    for (let i = 0; i < this.ast.classes.length; i++) {
      const cls = this.ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        const method = cls.methods[j];
        const qualName = cls.name + "." + method.name;
        this.checkParams(qualName, method.paramTypes, method as { loc?: SourceLocation });
      }
    }
  }

  private checkParams(
    funcName: string,
    paramTypes: string[] | undefined,
    locHolder: { loc?: SourceLocation },
  ): void {
    if (!paramTypes) return;
    for (let i = 0; i < paramTypes.length; i++) {
      if (this.isUnsafeAlias(paramTypes[i])) {
        this.reportError(funcName, paramTypes[i], locHolder.loc);
      }
    }
  }

  private reportError(funcName: string, aliasName: string, loc: SourceLocation | undefined): void {
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
}
