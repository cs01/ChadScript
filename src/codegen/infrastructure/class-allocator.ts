import {
  Expression,
  AST,
  VariableDeclaration,
  NewNode,
  MethodCallNode,
  CallNode,
  VariableNode,
  MemberAccessNode,
  IndexAccessNode,
} from "../../ast/types.js";
import { InterfaceAllocator } from "./interface-allocator.js";
import type { MapAllocator } from "./map-allocator.js";
import {
  SymbolKind_Class,
  SymbolTable,
  SymbolMetadata,
  createClassMetadata,
} from "./symbol-table.js";
import { stripNullable } from "./type-system.js";
import type { FieldInfo } from "./type-resolver/types.js";
import type { ResolvedType } from "./type-system.js";

interface ExprBase {
  type: string;
}

export interface ClassAllocatorContext {
  nextTemp(): string;
  nextAllocaReg(varName: string): string;
  emit(instruction: string): void;
  defineVariableWithMetadata(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: number,
    scope: string,
    metadata: SymbolMetadata,
  ): void;
  generateExpression(expr: Expression, params: string[]): string;
  resolveExpressionType(expr: Expression): ResolvedType | null;
  typeOf(expr: Expression): ResolvedType | null;
  getVariableType(name: string): string | undefined;
  resolveImportAlias(localName: string): string;
  getAst(): AST | undefined;
  getCurrentClassName(): string | null;
  classGenGetClassFields(className: string): { name: string; fieldType: string }[];
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  readonly symbolTable: SymbolTable;
  getObjectArrayElementType(expr: Expression): string | null;
}

export class ClassAllocator {
  private ctx: ClassAllocatorContext;
  private interfaceAlloc: InterfaceAllocator;
  private mapAlloc: MapAllocator;

  constructor(
    ctx: ClassAllocatorContext,
    interfaceAlloc: InterfaceAllocator,
    mapAlloc: MapAllocator,
  ) {
    this.ctx = ctx;
    this.interfaceAlloc = interfaceAlloc;
    this.mapAlloc = mapAlloc;
  }

  allocateClassInstance(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    let className: string;

    const valueBase = stmt.value as ExprBase;
    if (valueBase.type === "new") {
      const newExpr = stmt.value as NewNode;
      className = this.ctx.resolveImportAlias(newExpr.className);
    } else if (valueBase.type === "method_call") {
      const methodExpr = stmt.value as MethodCallNode;
      className =
        this.mapAlloc.getMapGetClassName(methodExpr) ||
        this.getMethodCallReturnClassName(methodExpr) ||
        "Unknown";
    } else if (valueBase.type === "call") {
      const callExpr = stmt.value as CallNode;
      className = this.getCallReturnClassName(callExpr) || "Unknown";
    } else if (valueBase.type === "index_access") {
      className = this.getIndexAccessClassName(stmt.value) || "Unknown";
    } else if (valueBase.type === "member_access") {
      className = this.getMemberAccessClassName(stmt.value) || "Unknown";
    } else if (valueBase.type === "variable") {
      const srcName = (stmt.value as VariableNode).name;
      const srcMeta = this.ctx.symbolTable.getClassMetadata(srcName);
      className = srcMeta ? srcMeta.className : "Unknown";
    } else if (valueBase.type === "ternary") {
      const resolved = stmt.value ? this.ctx.typeOf(stmt.value) : null;
      if (resolved && this.interfaceAlloc.isKnownClass(resolved.base)) {
        className = resolved.base;
      } else {
        className = "Unknown";
      }
    } else if (stmt.declaredType) {
      className = stripNullable(stmt.declaredType);
    } else {
      className = "Unknown";
    }

    const fields = this.ctx.classGenGetClassFields(className);
    const ptrType = fields.length > 0 ? `%${className}_struct*` : "i8*";

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      ptrType,
      SymbolKind_Class,
      "local",
      createClassMetadata({ className }),
    );
    this.ctx.emit(`${allocaReg} = alloca ${ptrType}`);

    const instancePtr = this.ctx.generateExpression(stmt.value!, params);
    if (fields.length > 0) {
      const valueType = this.ctx.getVariableType(instancePtr);
      if (valueType === ptrType) {
        this.ctx.emit(`store ${ptrType} ${instancePtr}, ${ptrType}* ${allocaReg}`);
      } else {
        const typedPtr = this.ctx.nextTemp();
        this.ctx.emit(`${typedPtr} = bitcast i8* ${instancePtr} to ${ptrType}`);
        this.ctx.emit(`store ${ptrType} ${typedPtr}, ${ptrType}* ${allocaReg}`);
      }
    } else {
      this.ctx.emit(`store ${ptrType} ${instancePtr}, ${ptrType}* ${allocaReg}`);
    }
  }

  getMethodCallReturnClassName(methodExpr: MethodCallNode): string | null {
    const methodObjBase = methodExpr.object as ExprBase;
    let objClassName: string | null = null;
    if (methodObjBase.type === "variable") {
      const varName = (methodExpr.object as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        objClassName = this.ctx.symbolTable.getClassName(varName) || null;
      }
    } else if (methodObjBase.type === "this") {
      objClassName = this.ctx.getCurrentClassName() || null;
    }
    if (!objClassName) return null;
    const ast = this.ctx.getAst();
    if (!ast) return null;
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      if (cls && cls.name === objClassName) {
        for (let j = 0; j < cls.methods.length; j++) {
          const m = cls.methods[j];
          if (m && m.name === methodExpr.method && m.returnType) {
            const rt = stripNullable(m.returnType);
            if (this.interfaceAlloc.isKnownClass(rt)) {
              return this.ctx.resolveImportAlias(rt);
            }
          }
        }
      }
    }
    return null;
  }

  getCallReturnClassName(callExpr: CallNode): string | null {
    if (!callExpr.name) return null;
    const ast = this.ctx.getAst();
    if (!ast) return null;
    for (let i = 0; i < ast.functions.length; i++) {
      const fn = ast.functions[i];
      if (fn && fn.name === callExpr.name && fn.returnType) {
        const rt = stripNullable(fn.returnType);
        if (this.interfaceAlloc.isKnownClass(rt)) {
          return this.ctx.resolveImportAlias(rt);
        }
      }
    }
    if (callExpr.name) {
      const resolved = this.ctx.resolveImportAlias(callExpr.name);
      for (let i = 0; i < ast.functions.length; i++) {
        const fn = ast.functions[i];
        if (fn && fn.name === resolved && fn.returnType) {
          const rt = stripNullable(fn.returnType);
          if (this.interfaceAlloc.isKnownClass(rt)) {
            return this.ctx.resolveImportAlias(rt);
          }
        }
      }
    }
    return null;
  }

  getIndexAccessClassName(expr: Expression | null): string | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (e.type !== "index_access") return null;
    const indexExpr = expr as IndexAccessNode;
    if (!indexExpr.object) return null;
    const objBase = indexExpr.object as ExprBase;
    if (objBase.type === "variable") {
      const varName = (indexExpr.object as VariableNode).name;
      const rawType = this.ctx.symbolTable.getRawInterfaceType(varName);
      if (rawType && this.interfaceAlloc.isKnownClass(rawType)) return rawType;
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (
        objArrayMeta &&
        objArrayMeta.elementInterfaceName &&
        this.interfaceAlloc.isKnownClass(objArrayMeta.elementInterfaceName)
      ) {
        return objArrayMeta.elementInterfaceName;
      }
    } else if (objBase.type === "method_call") {
      const methodExpr = indexExpr.object as MethodCallNode;
      const elemType = this.ctx.getObjectArrayElementType(methodExpr);
      if (elemType && this.interfaceAlloc.isKnownClass(elemType)) return elemType;
    } else if (objBase.type === "member_access") {
      const memberAccess = indexExpr.object as MemberAccessNode;
      const memberObjBase = memberAccess.object as ExprBase;
      let ownerClassName: string | null = null;
      if (memberObjBase.type === "this") {
        ownerClassName = this.ctx.getCurrentClassName();
      } else if (memberObjBase.type === "variable") {
        const vn = (memberAccess.object as VariableNode).name;
        if (this.ctx.symbolTable.isClass(vn)) {
          const cm = this.ctx.symbolTable.getClassInfo(vn);
          if (cm) ownerClassName = cm.className;
        }
      }
      if (ownerClassName) {
        const fieldInfo = this.ctx.classGenGetFieldInfo(ownerClassName, memberAccess.property);
        if (fieldInfo && fieldInfo.tsType) {
          let tsType = fieldInfo.tsType;
          if (tsType.indexOf(" | ") !== -1) {
            tsType = tsType
              .replace(/ \| undefined/g, "")
              .replace(/ \| null/g, "")
              .trim();
          }
          if (tsType.endsWith("[]")) {
            const elemType = tsType.substring(0, tsType.length - 2);
            if (this.interfaceAlloc.isKnownClass(elemType)) return elemType;
          }
        }
      }
    }
    return null;
  }

  getMemberAccessClassName(expr: Expression | null): string | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (e.type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;
    const objBase = memberExpr.object as ExprBase;
    let className: string | null = null;
    if (objBase.type === "variable") {
      const varName = (memberExpr.object as VariableNode).name;
      const classMeta = this.ctx.symbolTable.getClassMetadata(varName);
      if (!classMeta) return null;
      className = classMeta.className;
    } else if (objBase.type === "this") {
      className = this.ctx.getCurrentClassName();
    }
    if (!className) return null;
    const ast = this.ctx.getAst();
    if (ast && ast.classes) {
      for (let j = 0; j < ast.classes.length; j++) {
        const cls = ast.classes[j];
        if (!cls || !cls.fields) continue;
        if (cls.name !== className) continue;
        for (let k = 0; k < cls.fields.length; k++) {
          const field = cls.fields[k] as { name: string; fieldType: string; tsType?: string };
          if (field.name === memberExpr.property) {
            const rawType = field.tsType || field.fieldType;
            const tsType = stripNullable(rawType);
            if (this.interfaceAlloc.isKnownClass(tsType)) return tsType;
          }
        }
      }
    }
    return null;
  }
}
