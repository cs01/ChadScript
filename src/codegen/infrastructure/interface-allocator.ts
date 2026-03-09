// Interface-related allocation logic extracted from variable-allocator.ts.
// Handles getDeclaredInterfaceType, allocateDeclaredInterface, allocateMemberAccessInterface,
// and supporting helpers (getInterface, getAllInterfaceFields, parseInlineObjectType).

import {
  Expression,
  AST,
  VariableDeclaration,
  InterfaceDeclaration,
  InterfaceField,
  TypeAssertionNode,
} from "../../ast/types.js";
import {
  SymbolKind,
  SymbolTable,
  ObjectMetadata,
  SymbolMetadata,
  createObjectMetadataWithInterface,
} from "./symbol-table.js";
import { stripOptional, stripNullable, tsTypeToLlvm } from "./type-system.js";
import type { TypeResolver } from "./type-resolver/index.js";

// Context interface — subset of VariableAllocatorContext needed by this module.
export interface InterfaceAllocatorContext {
  readonly typeResolver?: TypeResolver;
  readonly symbolTable: SymbolTable;
  getAst(): AST | undefined;
  nextAllocaReg(name: string): string;
  nextTemp(): string;
  defineVariableWithMetadata(
    name: string,
    alloca: string,
    llvmType: string,
    kind: SymbolKind,
    scope: string,
    metadata: SymbolMetadata,
  ): void;
  emit(instruction: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  setCurrentDeclaredInterfaceType(type: string | undefined): void;
  setLastTypeAssertionSourceVar(name: string | null): void;
  getLastTypeAssertionSourceVar(): string | null;
}

export class InterfaceAllocator {
  private ctx: InterfaceAllocatorContext;

  constructor(ctx: InterfaceAllocatorContext) {
    this.ctx = ctx;
  }

  /**
   * Parse an inline object type string like "{ name: string; age: number }" into fields.
   * Pure function — no dependencies.
   */
  parseInlineObjectType(typeStr: string): InterfaceField[] | null {
    return parseInlineObjectType(typeStr);
  }

  getInterface(name: string): InterfaceDeclaration | null {
    if (!name) return null;
    const result = this.ctx.typeResolver?.getInterface(name);
    if (result) {
      return result;
    }
    const ast = this.ctx.getAst();
    if (!ast || !ast.interfaces) return null;
    for (let i = 0; i < ast.interfaces.length; i++) {
      const iface = ast.interfaces[i] as InterfaceDeclaration;
      if (!iface || !iface.name) continue;
      if (iface.name === name) {
        return iface;
      }
    }
    return null;
  }

  getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[] {
    const result: InterfaceField[] = [];
    if (iface.extends && iface.extends.length > 0) {
      for (let i = 0; i < iface.extends.length; i++) {
        const parentName = iface.extends[i];
        const parent = this.getInterface(parentName);
        if (parent) {
          const parentFields = this.getAllInterfaceFields(parent);
          for (let j = 0; j < parentFields.length; j++) {
            result.push(parentFields[j]);
          }
        }
      }
    }
    for (let i = 0; i < iface.fields.length; i++) {
      result.push(iface.fields[i]);
    }
    return result;
  }

  isEnumType(typeName: string): boolean {
    const ast = this.ctx.getAst();
    if (!ast || !ast.enums) return false;
    let checkType = typeName;
    if (checkType.indexOf(" | ") !== -1) {
      const parts = checkType.split(" | ");
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j].trim();
        if (part !== "undefined" && part !== "null") {
          checkType = part;
          break;
        }
      }
    }
    for (let i = 0; i < ast.enums.length; i++) {
      if (ast.enums[i].name === checkType) {
        return true;
      }
    }
    return false;
  }

  convertTsType(tsType: string): string {
    if (this.isEnumType(tsType)) {
      return "double";
    }
    return tsTypeToLlvm(tsType);
  }

  getDeclaredInterfaceType(stmt: VariableDeclaration): string | null {
    if (stmt.value && stmt.value.type === "type_assertion") {
      const assertionNode = stmt.value as TypeAssertionNode;
      const assertedType = assertionNode.assertedType;
      if (assertedType.startsWith("{")) {
        const innerType = assertedType.slice(1).trim();
        if (innerType.startsWith("[")) return null;
        return assertedType;
      }
      const interfaceDefResult = this.getInterface(assertedType);
      if (interfaceDefResult) {
        return assertedType;
      }
    }
    if (!stmt.declaredType) return null;
    const strippedDeclaredType = stripNullable(stmt.declaredType);
    if (strippedDeclaredType.startsWith("{") && stmt.value && stmt.value.type === "object") {
      const innerType = strippedDeclaredType.slice(1).trim();
      if (innerType.startsWith("[")) return null;
      return strippedDeclaredType;
    }
    if (
      !stmt.value ||
      (stmt.value.type !== "variable" &&
        stmt.value.type !== "object" &&
        stmt.value.type !== "method_call" &&
        stmt.value.type !== "call")
    )
      return null;
    const interfaceDefResult2 = this.getInterface(stmt.declaredType);
    if (!interfaceDefResult2) return null;
    return stmt.declaredType;
  }

  allocateDeclaredInterface(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];

    if (interfaceName.startsWith("{")) {
      const inlineFields = this.parseInlineObjectType(interfaceName);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.convertTsType(field.type));
          tsTypes.push(field.type);
        }
      }
    } else {
      const interfaceDefResult = this.getInterface(interfaceName);
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const allFields = this.getAllInterfaceFields(interfaceDef);
      for (let i = 0; i < allFields.length; i++) {
        const field = allFields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        types.push(this.convertTsType(field.type));
        tsTypes.push(field.type);
      }
    }

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind.Object,
      "local",
      createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    this.ctx.setCurrentDeclaredInterfaceType(interfaceName);
    // Clear stale state — the orchestrator sets lastTypeAssertionSourceVar for ALL
    // type assertions, not just ones in variable declarations.
    this.ctx.setLastTypeAssertionSourceVar(null);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.setCurrentDeclaredInterfaceType(undefined);

    // When a type assertion wraps an existing object variable (e.g., obj as { age: number; name: string }),
    // the memory layout is fixed by the object literal's creation-site field order — not the
    // assertion's field order. Reorder OUR keys/types to match the source's field order so GEP
    // indices align with the actual struct layout. We reorder rather than copy to ensure we always
    // use our correctly-converted LLVM types (source metadata may have TS types in some cases).
    if (stmt.value && stmt.value.type === "type_assertion" && keys.length > 0) {
      const sourceVar = this.ctx.getLastTypeAssertionSourceVar();
      this.ctx.setLastTypeAssertionSourceVar(null);
      if (sourceVar && this.ctx.symbolTable.isObject(sourceVar)) {
        const srcMeta = this.ctx.symbolTable.getObjectMetadata(sourceVar);
        if (srcMeta && srcMeta.keys.length > 0) {
          // Check that source has ALL of our keys (possibly reordered, possibly with extras)
          let allKeysPresent = true;
          for (let i = 0; i < keys.length; i++) {
            if (srcMeta.keys.indexOf(keys[i]) === -1) {
              allKeysPresent = false;
              break;
            }
          }
          if (allKeysPresent) {
            // Reorder our keys/types/tsTypes to match source's field order.
            // Use source's field order but our LLVM type mappings.
            const reorderedKeys: string[] = [];
            const reorderedTypes: string[] = [];
            const reorderedTsTypes: string[] = [];
            for (let si = 0; si < srcMeta.keys.length; si++) {
              const srcKey = srcMeta.keys[si];
              const ourIdx = keys.indexOf(srcKey);
              if (ourIdx !== -1) {
                reorderedKeys.push(srcKey);
                reorderedTypes.push(types[ourIdx]);
                reorderedTsTypes.push(tsTypes[ourIdx]);
              } else {
                // Source has extra fields not in our assertion — include them for correct
                // GEP indexing. Convert types through convertTsType since source metadata
                // may have TS types in the types array in some code paths.
                reorderedKeys.push(srcKey);
                const srcTs = srcMeta.tsTypes || srcMeta.types;
                reorderedTypes.push(this.convertTsType(srcTs[si]));
                reorderedTsTypes.push(srcTs[si]);
              }
            }
            this.ctx.defineVariableWithMetadata(
              stmt.name,
              allocaReg,
              "i8*",
              SymbolKind.Object,
              "local",
              createObjectMetadataWithInterface(
                { keys: reorderedKeys, types: reorderedTypes, tsTypes: reorderedTsTypes },
                interfaceName,
              ),
            );
          }
        }
      }
    }

    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  allocateMemberAccessInterface(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    const interfaceDefResult = this.getInterface(interfaceName);
    const interfaceDef = interfaceDefResult as InterfaceDeclaration;
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    const allFields = this.getAllInterfaceFields(interfaceDef);
    for (let i = 0; i < allFields.length; i++) {
      const field = allFields[i] as { name: string; type: string };
      keys.push(stripOptional(field.name));
      types.push(this.convertTsType(field.type));
      tsTypes.push(field.type);
    }
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind.Object,
      "local",
      createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }
}

// Pure function — no class or context dependencies.
export function parseInlineObjectType(typeStr: string): InterfaceField[] | null {
  if (!typeStr.startsWith("{") || !typeStr.endsWith("}")) {
    return null;
  }
  const inner = typeStr.slice(1, typeStr.length - 1).trim();
  if (inner.length === 0) {
    return [];
  }
  const fields: InterfaceField[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "{" || ch === "(" || ch === "[" || ch === "<") {
      depth++;
    } else if (ch === "}" || ch === ")" || ch === "]" || ch === ">") {
      depth--;
    } else if (ch === ";" && depth === 0) {
      const part = inner.slice(start, i).trim();
      if (part) {
        const colonIdx = part.indexOf(":");
        if (colonIdx !== -1) {
          const name = part.slice(0, colonIdx).trim();
          const fieldType = part.slice(colonIdx + 1).trim();
          fields.push({ name, type: fieldType });
        }
      }
      start = i + 1;
    }
  }
  const lastPart = inner.slice(start).trim();
  if (lastPart) {
    const colonIdx = lastPart.indexOf(":");
    if (colonIdx !== -1) {
      const name = lastPart.slice(0, colonIdx).trim();
      const fieldType = lastPart.slice(colonIdx + 1).trim();
      fields.push({ name, type: fieldType });
    }
  }
  return fields;
}
