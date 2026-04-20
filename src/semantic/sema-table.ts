// Sema table: pure-AST symbol catalog built pre-codegen. Captures all
// class + interface names/declarations from the AST so consumers can
// answer "is this name a class?" / "get this interface's declaration"
// without touching codegen-time symbol-table state.
//
// This is the first step of extracting Sema as its own pass (refactor
// plan step 6). TypeInference used to read this same data through
// `this.st.isClass(name)` etc., but SymbolTable is populated DURING
// codegen — the annotator running pre-codegen saw stale/empty data.
// SemaTable is built once from the AST and is authoritative for these
// queries.

import type { AST, ClassNode, InterfaceDeclaration } from "../ast/types.js";

export class SemaTable {
  private classNames: string[] = [];
  private classByName: Map<string, ClassNode> = new Map();
  private interfaceNames: string[] = [];
  private interfaceByName: Map<string, InterfaceDeclaration> = new Map();

  constructor(ast: AST) {
    if (ast.classes) {
      for (let i = 0; i < ast.classes.length; i++) {
        const c = ast.classes[i];
        if (c && c.name) {
          this.classNames.push(c.name);
          this.classByName.set(c.name, c);
        }
      }
    }
    if (ast.interfaces) {
      for (let i = 0; i < ast.interfaces.length; i++) {
        const ifc = ast.interfaces[i];
        if (ifc && ifc.name) {
          this.interfaceNames.push(ifc.name);
          this.interfaceByName.set(ifc.name, ifc);
        }
      }
    }
  }

  isClass(name: string): boolean {
    return this.classByName.has(name);
  }

  getClass(name: string): ClassNode | undefined {
    return this.classByName.get(name);
  }

  isInterface(name: string): boolean {
    return this.interfaceByName.has(name);
  }

  getInterface(name: string): InterfaceDeclaration | undefined {
    return this.interfaceByName.get(name);
  }
}
