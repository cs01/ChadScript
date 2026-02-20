import {
  Expression,
  MethodCallNode,
  VariableNode,
  MemberAccessNode,
  TypeAssertionNode,
  InterfaceDeclaration,
  InterfaceField,
} from "../../../ast/types.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";

interface ExprBase {
  type: string;
}
interface InterfaceDefInfo {
  properties: { name: string; type: string }[];
}

type NewNode = { type: "new"; className: string };
type ObjectNode = { type: "object"; properties: { key: string }[] };
type ClassNode = {
  name: string;
  extends?: string;
  implements?: string[];
  methods: { name: string; isConstructor?: boolean }[];
};
type FunctionNode = {
  name: string;
  returnType?: string;
  parameters?: { type: string }[];
  paramTypes?: string[];
};

export function getInterfaceFromAST(
  ctx: MethodCallGeneratorContext,
  name: string,
): InterfaceDefInfo | null {
  const len = ctx.getAstInterfacesLength();
  for (let i = 0; i < len; i++) {
    const ifaceName = ctx.getAstInterfaceNameAt(i);
    if (ifaceName === name) {
      const ifaceItem = ctx.getAstInterfaceAt(i);
      if (!ifaceItem) continue;
      const properties: { name: string; type: string }[] = [];
      for (let j = 0; j < ifaceItem.fields.length; j++) {
        const field = ifaceItem.fields[j] as { name: string; type: string };
        properties.push({ name: field.name, type: field.type });
      }
      return { properties };
    }
  }
  return null;
}

export function getInterfaceDecl(
  ctx: MethodCallGeneratorContext,
  name: string,
): InterfaceDeclaration | null {
  const len = ctx.getAstInterfacesLength();
  for (let i = 0; i < len; i++) {
    const ifaceName = ctx.getAstInterfaceNameAt(i);
    if (ifaceName === name) {
      return ctx.getAstInterfaceAt(i);
    }
  }
  return null;
}

function getFunctionFromAST(ctx: MethodCallGeneratorContext, name: string): FunctionNode | null {
  const len = ctx.getAstFunctionsLength();
  for (let i = 0; i < len; i++) {
    const funcName = ctx.getAstFunctionNameAt(i);
    if (funcName === name) {
      return ctx.getAstFunctionAt(i) as FunctionNode | null;
    }
  }
  return null;
}

export function findClassWithMethod(
  ctx: MethodCallGeneratorContext,
  className: string,
  methodName: string,
): string | null {
  let classNodeResult: ClassNode | null = null;
  const classesLen7 = ctx.getAstClassesLength();
  for (let ci = 0; ci < classesLen7; ci++) {
    const cName = ctx.getAstClassNameAt(ci);
    if (cName === className) {
      classNodeResult = ctx.getAstClassAt(ci) as ClassNode | null;
      break;
    }
  }
  const classNode = classNodeResult as ClassNode;
  if (!classNodeResult) return null;

  let methodExists = false;
  for (let mi = 0; mi < classNode.methods.length; mi++) {
    const m = classNode.methods[mi];
    if (m.name === methodName && !m.isConstructor) {
      methodExists = true;
      break;
    }
  }
  if (methodExists) return className;

  if (classNode.extends) {
    return findClassWithMethod(ctx, classNode.extends, methodName);
  }

  return null;
}

function classImplementsInterface(
  ctx: MethodCallGeneratorContext,
  className: string,
  interfaceName: string,
): boolean {
  const classesLen11 = ctx.getAstClassesLength();
  for (let i = 0; i < classesLen11; i++) {
    const cName = ctx.getAstClassNameAt(i);
    if (cName === className) {
      const cls = ctx.getAstClassAt(i) as ClassNode | null;
      if (!cls) return false;
      if (cls.implements) {
        for (let j = 0; j < cls.implements.length; j++) {
          if (cls.implements[j] === interfaceName) {
            return true;
          }
        }
      }
      if (cls.extends) {
        return classImplementsInterface(ctx, cls.extends, interfaceName);
      }
      return false;
    }
  }
  return false;
}

function classHasAllMethods(
  ctx: MethodCallGeneratorContext,
  className: string,
  methods: string[],
): boolean {
  for (let i = 0; i < methods.length; i++) {
    if (!findClassWithMethod(ctx, className, methods[i])) {
      return false;
    }
  }
  return true;
}

function collectInterfaceMethods(
  ctx: MethodCallGeneratorContext,
  interfaceName: string,
  methods: string[],
  visited: string[],
): void {
  for (let v = 0; v < visited.length; v++) {
    if (visited[v] === interfaceName) return;
  }
  visited.push(interfaceName);

  let bestInterface: {
    name: string;
    extends?: string[];
    fields: { name: string; type: string }[];
    methods?: { name: string }[];
  } | null = null;
  let maxMethods = 0;
  const interfacesLen4 = ctx.getAstInterfacesLength();
  for (let i = 0; i < interfacesLen4; i++) {
    const ifaceName = ctx.getAstInterfaceNameAt(i);
    if (ifaceName === interfaceName) {
      const iface = ctx.getAstInterfaceAt(i);
      if (!iface) continue;
      const methodCount = iface.methods ? iface.methods.length : 0;
      if (methodCount > maxMethods || !bestInterface) {
        maxMethods = methodCount;
        bestInterface = iface;
      }
    }
  }
  if (!bestInterface) return;

  if (bestInterface.methods) {
    for (let i = 0; i < bestInterface.methods.length; i++) {
      const methodName = bestInterface.methods[i].name;
      let alreadyHas = false;
      for (let m = 0; m < methods.length; m++) {
        if (methods[m] === methodName) {
          alreadyHas = true;
          break;
        }
      }
      if (!alreadyHas) {
        methods.push(methodName);
      }
    }
  }

  if (bestInterface.extends) {
    for (let i = 0; i < bestInterface.extends.length; i++) {
      collectInterfaceMethods(ctx, bestInterface.extends[i], methods, visited);
    }
  }
}

export function getAllInterfaceMethods(
  ctx: MethodCallGeneratorContext,
  interfaceName: string,
): string[] {
  const visited: string[] = [];
  const methods: string[] = [];
  collectInterfaceMethods(ctx, interfaceName, methods, visited);
  return methods;
}

export function findPrimaryImplementingClass(
  ctx: MethodCallGeneratorContext,
  methodName: string,
): string | null {
  const classesLen10 = ctx.getAstClassesLength();
  for (let ci = 0; ci < classesLen10; ci++) {
    const cls = ctx.getAstClassAt(ci) as ClassNode | null;
    if (!cls) continue;
    if (cls.implements && cls.implements.length > 0) {
      const hasMethod = findClassWithMethod(ctx, cls.name, methodName);
      if (hasMethod) {
        return hasMethod;
      }
    }
  }
  for (let ci = 0; ci < classesLen10; ci++) {
    const clsName = ctx.getAstClassNameAt(ci);
    if (!clsName) continue;
    const hasMethod = findClassWithMethod(ctx, clsName, methodName);
    if (hasMethod) {
      return hasMethod;
    }
  }
  return null;
}

export function findClassStructurallyMatchingInterface(
  ctx: MethodCallGeneratorContext,
  interfaceName: string,
  methodName: string,
): string | null {
  const allMethods = getAllInterfaceMethods(ctx, interfaceName);
  if (allMethods.length === 0) {
    const primaryClass = findPrimaryImplementingClass(ctx, methodName);
    if (primaryClass) {
      return primaryClass;
    }
    return null;
  }
  const classesLen9 = ctx.getAstClassesLength();
  for (let ci = 0; ci < classesLen9; ci++) {
    const clsName = ctx.getAstClassNameAt(ci);
    if (!clsName) continue;
    if (classHasAllMethods(ctx, clsName, allMethods)) {
      const hasTargetMethod = findClassWithMethod(ctx, clsName, methodName);
      if (hasTargetMethod) {
        return clsName;
      }
    }
  }
  return null;
}

export function findClassImplementingInterfaceMethod(
  ctx: MethodCallGeneratorContext,
  interfaceName: string,
  methodName: string,
): string | null {
  const classesLen8 = ctx.getAstClassesLength();
  for (let i = 0; i < classesLen8; i++) {
    const cls = ctx.getAstClassAt(i) as ClassNode | null;
    if (!cls) continue;
    if (!classImplementsInterface(ctx, cls.name, interfaceName)) {
      continue;
    }
    let hasMethod = false;
    for (let mi = 0; mi < cls.methods.length; mi++) {
      const m = cls.methods[mi];
      if (m.name === methodName && !m.isConstructor) {
        hasMethod = true;
        break;
      }
    }
    if (hasMethod) {
      return cls.name;
    }
    if (cls.extends) {
      const parentHasMethod = findClassWithMethod(ctx, cls.extends, methodName);
      if (parentHasMethod) {
        return cls.name;
      }
    }
  }
  const structuralMatch = findClassStructurallyMatchingInterface(ctx, interfaceName, methodName);
  if (structuralMatch) {
    return structuralMatch;
  }
  return null;
}

export function resolveNestedMemberAccessType(
  ctx: MethodCallGeneratorContext,
  expr: Expression,
): string | null {
  const e = expr as ExprBase;
  if (e.type === "this") {
    return ctx.getCurrentClassName();
  }

  if (e.type === "variable") {
    const varName = (expr as VariableNode).name;
    if (ctx.symbolTable.isClass(varName)) {
      const classMeta = ctx.symbolTable.getClassInfo(varName);
      return classMeta ? classMeta.className || null : null;
    }
    const interfaceType = ctx.symbolTable.getInterfaceType(varName);
    if (interfaceType) {
      return interfaceType;
    }
    return null;
  }

  if (e.type === "member_access") {
    const memberAccess = expr as MemberAccessNode;
    const parentType = resolveNestedMemberAccessType(ctx, memberAccess.object);
    if (!parentType) {
      return null;
    }

    let classExists = false;
    const classesLen3 = ctx.getAstClassesLength();
    for (let ci = 0; ci < classesLen3; ci++) {
      const cName = ctx.getAstClassNameAt(ci);
      if (cName === parentType) {
        classExists = true;
        break;
      }
    }
    if (classExists) {
      const fieldInfoResult = ctx.classGenGetFieldInfo(parentType, memberAccess.property);
      const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
      if (fieldInfoResult && fieldInfo.tsType) {
        let cleanFieldType = fieldInfo.tsType;
        if (cleanFieldType.indexOf(" | ") !== -1) {
          cleanFieldType = cleanFieldType
            .replace(/ \| undefined/g, "")
            .replace(/ \| null/g, "")
            .trim();
        }
        let fieldClassExists = false;
        const classesLen4 = ctx.getAstClassesLength();
        for (let ci = 0; ci < classesLen4; ci++) {
          const cName = ctx.getAstClassNameAt(ci);
          if (cName === cleanFieldType) {
            fieldClassExists = true;
            break;
          }
        }
        if (fieldClassExists) {
          return cleanFieldType;
        }
        let fieldInterfaceExists = false;
        const interfacesLen3 = ctx.getAstInterfacesLength();
        for (let ii = 0; ii < interfacesLen3; ii++) {
          const ifaceName = ctx.getAstInterfaceNameAt(ii);
          if (ifaceName === cleanFieldType) {
            fieldInterfaceExists = true;
            break;
          }
        }
        if (fieldInterfaceExists) {
          return cleanFieldType;
        }
      }
      return null;
    }

    const interfaceDeclResult = getInterfaceDecl(ctx, parentType);
    const interfaceDecl = interfaceDeclResult as InterfaceDeclaration;
    if (interfaceDeclResult) {
      let fieldResult: InterfaceField | null = null;
      for (let i = 0; i < interfaceDecl.fields.length; i++) {
        const f = interfaceDecl.fields[i] as { name: string; type: string };
        if (f.name === memberAccess.property) {
          fieldResult = f;
          break;
        }
      }
      const field = fieldResult as { name: string; type: string };
      if (fieldResult) {
        let fieldType = field.type;
        if (fieldType.endsWith(" | null") || fieldType.endsWith(" | undefined")) {
          fieldType = fieldType.replace(/ \| null$/, "").replace(/ \| undefined$/, "");
        }
        let fieldClassExists = false;
        const classesLen12 = ctx.getAstClassesLength();
        for (let ci = 0; ci < classesLen12; ci++) {
          const cName = ctx.getAstClassNameAt(ci);
          if (cName === fieldType) {
            fieldClassExists = true;
            break;
          }
        }
        if (fieldClassExists) {
          return fieldType;
        }
        let fieldInterfaceExists = false;
        const interfacesLen6 = ctx.getAstInterfacesLength();
        for (let ii = 0; ii < interfacesLen6; ii++) {
          const ifaceName = ctx.getAstInterfaceNameAt(ii);
          if (ifaceName === fieldType) {
            fieldInterfaceExists = true;
            break;
          }
        }
        if (fieldInterfaceExists) {
          return fieldType;
        }
      }
      return null;
    }

    return null;
  }

  return null;
}

export function handleClassMethods(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string | null {
  const method = expr.method;
  let className: string | null = null;
  let instancePtr: string | null = null;

  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    if (ctx.symbolTable.isClass(varName)) {
      const classMeta = ctx.symbolTable.getClassInfo(varName)!;
      className = classMeta.className;
      instancePtr = ctx.generateExpression(expr.object, params);
    } else {
      const concreteClass = ctx.symbolTable.getConcreteClass(varName);
      if (concreteClass) {
        instancePtr = ctx.generateExpression(expr.object, params);
        className = concreteClass;
      } else {
        const interfaceType = ctx.symbolTable.getInterfaceType(varName);
        if (interfaceType) {
          const implClass = findClassImplementingInterfaceMethod(ctx, interfaceType, method);
          if (implClass) {
            instancePtr = ctx.generateExpression(expr.object, params);
            className = implClass;
          }
        }
      }
    }
  } else if (exprObjBase.type === "new") {
    const newExpr = expr.object as NewNode;
    className = newExpr.className;
    instancePtr = ctx.generateExpression(expr.object, params);
  } else if (exprObjBase.type === "this") {
    const thisPtr = ctx.getThisPointer();
    if (!thisPtr) {
      ctx.emitError(`this.${method}() called outside of class method`, expr.loc);
    }
    instancePtr = thisPtr;
    if (ctx.getCurrentClassName()) {
      className = ctx.getCurrentClassName();
    } else {
      const classesLen5 = ctx.getAstClassesLength();
      if (classesLen5 === 0) {
        ctx.emitError(`Method ${method} not found in any class - no AST`, expr.loc);
      }
      let classWithMethodResult: ClassNode | null = null;
      for (let ci = 0; ci < classesLen5; ci++) {
        const c = ctx.getAstClassAt(ci) as ClassNode | null;
        if (!c) continue;
        let hasMethod = false;
        for (let mi = 0; mi < c.methods.length; mi++) {
          const m = c.methods[mi];
          if (m.name === method && !m.isConstructor) {
            hasMethod = true;
            break;
          }
        }
        if (hasMethod) {
          classWithMethodResult = c;
          break;
        }
      }
      const classWithMethod = classWithMethodResult as ClassNode;
      if (!classWithMethodResult) {
        ctx.emitError(`Method ${method} not found in any class`, expr.loc);
      }
      className = classWithMethod.name;
    }
  } else if (exprObjBase.type === "member_access") {
    const memberAccess = expr.object as MemberAccessNode;
    const memberAccessObjBase = memberAccess.object as ExprBase;
    const classNameForField = ctx.getCurrentClassName();
    if (memberAccessObjBase.type === "this" && classNameForField) {
      const fieldInfoResult = ctx.classGenGetFieldInfo(classNameForField, memberAccess.property);
      const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
      if (fieldInfoResult && fieldInfo.tsType) {
        let fieldClassName = fieldInfo.tsType;
        if (fieldClassName.indexOf(" | ") !== -1) {
          fieldClassName = fieldClassName
            .replace(/ \| undefined/g, "")
            .replace(/ \| null/g, "")
            .trim();
        }
        let classExists = false;
        const classesLen = ctx.getAstClassesLength();
        for (let ci = 0; ci < classesLen; ci++) {
          const cName = ctx.getAstClassNameAt(ci);
          if (cName === fieldClassName) {
            classExists = true;
            break;
          }
        }
        if (classExists) {
          instancePtr = ctx.generateExpression(expr.object, params);
          className = fieldClassName;
        } else {
          let interfaceExists = false;
          const interfacesLen = ctx.getAstInterfacesLength();
          for (let ii = 0; ii < interfacesLen; ii++) {
            const ifaceName = ctx.getAstInterfaceNameAt(ii);
            if (ifaceName === fieldClassName) {
              interfaceExists = true;
              break;
            }
          }
          if (interfaceExists) {
            const implClass = findClassImplementingInterfaceMethod(ctx, fieldClassName, method);
            if (implClass) {
              instancePtr = ctx.generateExpression(expr.object, params);
              className = implClass;
            } else {
            }
          } else {
          }
        }
      }
    } else if (memberAccessObjBase.type === "variable") {
      const varName = (memberAccess.object as VariableNode).name;
      const concreteClass =
        ctx.symbolTable.getConcreteClass(varName) || ctx.getActualClassType(varName);
      if (concreteClass) {
        const fieldInfoResult = ctx.classGenGetFieldInfo(concreteClass, memberAccess.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType) {
          let fieldClassName = fieldInfo.tsType;
          if (fieldClassName.indexOf(" | ") !== -1) {
            fieldClassName = fieldClassName
              .replace(/ \| undefined/g, "")
              .replace(/ \| null/g, "")
              .trim();
          }
          const resolvedClass = findClassWithMethod(ctx, fieldClassName, method);
          if (resolvedClass) {
            instancePtr = ctx.generateExpression(expr.object, params);
            className = resolvedClass;
          } else {
            const implClass = findClassImplementingInterfaceMethod(ctx, fieldClassName, method);
            if (implClass) {
              instancePtr = ctx.generateExpression(expr.object, params);
              className = implClass;
            }
          }
        }
      } else if (ctx.symbolTable.isClass(varName)) {
        const classMeta = ctx.symbolTable.getClassInfo(varName)!;
        const outerClassName = classMeta.className;
        const fieldInfoResult = ctx.classGenGetFieldInfo(outerClassName, memberAccess.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType) {
          let fieldClassName = fieldInfo.tsType;
          if (fieldClassName.indexOf(" | ") !== -1) {
            fieldClassName = fieldClassName
              .replace(/ \| undefined/g, "")
              .replace(/ \| null/g, "")
              .trim();
          }
          let classExists = false;
          const classesLen2 = ctx.getAstClassesLength();
          for (let ci = 0; ci < classesLen2; ci++) {
            const cName = ctx.getAstClassNameAt(ci);
            if (cName === fieldClassName) {
              classExists = true;
              break;
            }
          }
          if (classExists) {
            instancePtr = ctx.generateExpression(expr.object, params);
            className = fieldClassName;
          } else {
            let interfaceExists = false;
            const interfacesLen2 = ctx.getAstInterfacesLength();
            for (let ii = 0; ii < interfacesLen2; ii++) {
              const ifaceName = ctx.getAstInterfaceNameAt(ii);
              if (ifaceName === fieldClassName) {
                interfaceExists = true;
                break;
              }
            }
            if (interfaceExists) {
              const implClass = findClassImplementingInterfaceMethod(ctx, fieldClassName, method);
              if (implClass) {
                instancePtr = ctx.generateExpression(expr.object, params);
                className = implClass;
              }
            }
          }
        }
      } else {
        const interfaceType = ctx.symbolTable.getInterfaceType(varName);
        if (interfaceType) {
          const interfaceDeclResult = getInterfaceDecl(ctx, interfaceType);
          if (interfaceDeclResult) {
            const interfaceDecl = interfaceDeclResult as InterfaceDeclaration;
            for (let i = 0; i < interfaceDecl.fields.length; i++) {
              const f = interfaceDecl.fields[i] as { name: string; type: string };
              if (f.name === memberAccess.property) {
                let fieldType = f.type;
                if (fieldType.endsWith(" | null") || fieldType.endsWith(" | undefined")) {
                  fieldType = fieldType.replace(/ \| null$/, "").replace(/ \| undefined$/, "");
                }
                const resolvedClass = findClassWithMethod(ctx, fieldType, method);
                if (resolvedClass) {
                  instancePtr = ctx.generateExpression(expr.object, params);
                  className = resolvedClass;
                } else {
                  const implClass = findClassImplementingInterfaceMethod(ctx, fieldType, method);
                  if (implClass) {
                    instancePtr = ctx.generateExpression(expr.object, params);
                    className = implClass;
                  }
                }
                break;
              }
            }
          }
        }
      }
    } else if (memberAccessObjBase.type === "member_access") {
      const resolvedType = resolveNestedMemberAccessType(ctx, expr.object);
      if (resolvedType) {
        instancePtr = ctx.generateExpression(expr.object, params);
        className = resolvedType;
      }
    }
  } else if (exprObjBase.type === "super") {
    const thisPtr = ctx.getThisPointer();
    if (!thisPtr) {
      ctx.emitError("super.method() called outside of class method", expr.loc);
    }
    if (!ctx.getCurrentClassName()) {
      ctx.emitError("super.method() called outside of class context", expr.loc);
    }
    let currentClassResult: ClassNode | null = null;
    const classesLen6 = ctx.getAstClassesLength();
    for (let ci = 0; ci < classesLen6; ci++) {
      const cName = ctx.getAstClassNameAt(ci);
      if (cName === ctx.getCurrentClassName()) {
        currentClassResult = ctx.getAstClassAt(ci) as ClassNode | null;
        break;
      }
    }
    const currentClass = currentClassResult as ClassNode;
    if (!currentClassResult || !currentClass.extends) {
      ctx.emitError(
        `super.method() called but current class ${ctx.getCurrentClassName()} has no parent class`,
        expr.loc,
      );
    }
    instancePtr = thisPtr;
    className = currentClass.extends;

    if (method === "") {
      return "0";
    }
  } else if (exprObjBase.type === "type_assertion") {
    const assertExpr = expr.object as TypeAssertionNode;
    const innerExpr = assertExpr.expression;
    const innerExprBase = innerExpr as ExprBase;
    if (innerExprBase.type === "variable") {
      const varName = (innerExpr as VariableNode).name;
      if (ctx.symbolTable.isClass(varName)) {
        const classMeta = ctx.symbolTable.getClassInfo(varName)!;
        className = classMeta.className;
        instancePtr = ctx.generateExpression(innerExpr, params);
      }
    }
  }

  if (className && instancePtr) {
    let resolvedClass = findClassWithMethod(ctx, className, method);
    let isInterfaceClass = false;
    if (!resolvedClass) {
      let interfaceExists = false;
      const interfacesLen5 = ctx.getAstInterfacesLength();
      for (let ii = 0; ii < interfacesLen5; ii++) {
        const ifaceName = ctx.getAstInterfaceNameAt(ii);
        if (ifaceName === className) {
          interfaceExists = true;
          break;
        }
      }
      if (interfaceExists) {
        isInterfaceClass = true;
        resolvedClass = findClassImplementingInterfaceMethod(ctx, className, method);
      }
    }
    if (!resolvedClass) {
      ctx.emitError(`Method ${method} not found in class ${className}`, expr.loc);
    }

    const instanceClass = isInterfaceClass ? resolvedClass : className;
    return ctx.classGenGenerateMethodCall(instancePtr, instanceClass, method, expr.args, params);
  }

  if (!className && !instancePtr && exprObjBase.type === "member_access") {
    instancePtr = ctx.generateExpression(expr.object, params);
    if (instancePtr) {
      const actualClass = ctx.getActualClassType(instancePtr);
      if (actualClass) {
        className = actualClass;
        const resolvedClass = findClassWithMethod(ctx, actualClass, method);
        if (resolvedClass) {
          return ctx.classGenGenerateMethodCall(
            instancePtr,
            resolvedClass,
            method,
            expr.args,
            params,
          );
        }
      }
    }
  }

  return null;
}

export function handleObjectMethods(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string | null {
  const method = expr.method;
  let isObjectMethod = false;

  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    if (ctx.symbolTable.isObject(varName)) {
      const objMetaRaw = ctx.symbolTable.getObjectInfo(varName);
      if (!objMetaRaw) {
        return null;
      }
      const objMeta = objMetaRaw as {
        ptr: string;
        keys: string[];
        types: string[];
        tsTypes: string[] | undefined;
      };
      isObjectMethod = objMeta.keys.indexOf(method) !== -1;
    }
  } else if (exprObjBase.type === "object") {
    const objExpr = expr.object as ObjectNode;
    for (let pi = 0; pi < objExpr.properties.length; pi++) {
      const p = objExpr.properties[pi] as { key: string };
      if (p.key === method) {
        isObjectMethod = true;
        break;
      }
    }
  }

  if (!isObjectMethod) {
    return null;
  }

  let funcExists = false;
  const funcLen2 = ctx.getAstFunctionsLength();
  for (let i = 0; i < funcLen2; i++) {
    const fName = ctx.getAstFunctionNameAt(i);
    if (fName === method) {
      funcExists = true;
      break;
    }
  }
  if (!funcExists) {
    ctx.emitError(`Function ${method} not found for object method call`, expr.loc);
  }

  // Get function type from AST for correct parameter/return types
  let returnType = "double";
  let paramTypes: string[] = [];

  const funcNode = getFunctionFromAST(ctx, method);
  if (funcNode) {
    returnType = funcNode.returnType === "string" ? "i8*" : "double";
    if (funcNode.parameters) {
      for (let i = 0; i < funcNode.parameters.length; i++) {
        const param = funcNode.parameters[i];
        paramTypes.push(param.type === "string" ? "i8*" : "double");
      }
    } else if (funcNode.paramTypes) {
      for (let i = 0; i < funcNode.paramTypes.length; i++) {
        const t = funcNode.paramTypes[i];
        paramTypes.push(t === "string" ? "i8*" : "double");
      }
    }
  }

  // Generate arguments
  const argParts: string[] = [];
  for (let i = 0; i < expr.args.length; i++) {
    const arg = expr.args[i];
    const result = ctx.generateExpression(arg, params);
    const paramType = paramTypes[i] || "double";
    if (paramType === "double") {
      argParts.push("double " + ctx.ensureDouble(result));
    } else {
      argParts.push(paramType + " " + result);
    }
  }
  const args = argParts.join(", ");

  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = call ${returnType} @${ctx.mangleUserName(method)}(${args})`);
  return temp;
}
