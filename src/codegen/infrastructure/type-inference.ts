import { Expression, MethodCallNode, AST, MemberAccessNode, IndexAccessNode, CallNode, ArrayNode, NewNode, FunctionNode, ClassNode, ClassMethod, VariableNode, ConditionalExpressionNode, InterfaceDeclaration, InterfaceField, BinaryNode, TypeAssertionNode, UnaryNode } from '../../ast/types.js';
import { SymbolTable, SymbolKind } from './symbol-table.js';
import type { TypeChecker } from '../../typescript/type-checker.js';
import type { ClassGenerator } from '../types/objects/class.js';
import type { TypeResolver } from './type-resolver/index.js';
import { stripNullable, parseMapTypeString } from './type-system.js';
import type { ResolvedType } from './type-system.js';
import type { TypeContext } from './type-context.js';

interface ExprBase { type: string; }

function isStringType(t: string): boolean {
  if (t === 'string') return true;
  if (t === 'string | null' || t === 'string | undefined') return true;
  if (t === 'null | string' || t === 'undefined | string') return true;
  return false;
}

export interface TypeInferenceContext {
  symbolTable: SymbolTable;
  typeContext: TypeContext;
  getExpectedArrayElementType(): 'string' | 'number' | 'boolean' | 'pointer' | null;
  currentClassName: string | null;
  getCurrentClassName(): string | null;
  currentFunction: string;
  getCurrentFunction(): string | null;
  ast: AST;
  getAst(): AST | undefined;
  typeChecker: TypeChecker | null;
  classGen: ClassGenerator | null;
  hasClassGen(): boolean;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): { index: number; type: string; tsType?: string } | null;
  classGenGetFieldType(className: string, fieldName: string): string | null;
  classGenGetFieldTsType(className: string, fieldName: string): string | null;
  typeResolver?: TypeResolver;
  typeResolverGetInterface(name: string): InterfaceDeclaration | null;
  typeResolverGetInterfaceProperty(interfaceName: string, propName: string): InterfaceField | null;
}

export class TypeInference {
  constructor(private ctx: TypeInferenceContext) {}

  resolveExpressionType(expr: Expression): ResolvedType | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (!e.type) return null;
    if (e.type === 'number') return this.ctx.typeContext.numberType;
    if (e.type === 'string') return this.ctx.typeContext.stringType;
    if (e.type === 'template_literal') return this.ctx.typeContext.stringType;
    if (e.type === 'boolean') return this.ctx.typeContext.booleanType;
    if (e.type === 'null') return this.ctx.typeContext.nullType;
    if (e.type === 'regex') return this.ctx.typeContext.resolve('RegExp');
    if (e.type === 'object') return this.ctx.typeContext.resolve('object');
    if (e.type === 'map') return this.ctx.typeContext.getMapType('string', 'string');
    if (e.type === 'set') return this.ctx.typeContext.getSetType('string');
    if (e.type === 'variable') {
      return this.resolveVariableType((expr as VariableNode).name);
    }
    if (e.type === 'new') {
      const newExpr = expr as NewNode;
      if (newExpr.className === 'Map') return this.ctx.typeContext.getMapType('string', 'string');
      if (newExpr.className === 'Set') return this.ctx.typeContext.getSetType('string');
      if (newExpr.className === 'RegExp') return this.ctx.typeContext.resolve('RegExp');
      if (newExpr.className === 'Promise') return this.ctx.typeContext.resolve('Promise');
      const cls = this.getClass(newExpr.className);
      if (cls) return this.ctx.typeContext.getClassType(newExpr.className);
      return null;
    }
    if (e.type === 'array') {
      const arrayExpr = expr as ArrayNode;
      const elements = arrayExpr.elements || [];
      if (elements.length === 0) {
        const expected = this.ctx.getExpectedArrayElementType();
        if (expected === 'string') return this.ctx.typeContext.getArrayType('string');
        return this.ctx.typeContext.getArrayType('number');
      }
      const firstElem = elements[0] as ExprBase;
      if (firstElem.type === 'string') return this.ctx.typeContext.getArrayType('string');
      if (firstElem.type === 'number') return this.ctx.typeContext.getArrayType('number');
      if (firstElem.type === 'variable') {
        const varName = (elements[0] as VariableNode).name;
        if (this.ctx.symbolTable.isString(varName)) return this.ctx.typeContext.getArrayType('string');
        const varType = this.ctx.symbolTable.getType(varName);
        if (varType === 'i8*') return this.ctx.typeContext.getArrayType('string');
      }
      if (this.isStringExpression(elements[0])) return this.ctx.typeContext.getArrayType('string');
      return this.ctx.typeContext.getArrayType('number');
    }
    if (e.type === 'unary') {
      const unaryExpr = expr as UnaryNode;
      if (unaryExpr.op === 'typeof') return this.ctx.typeContext.stringType;
      if (unaryExpr.op === '!') return this.ctx.typeContext.booleanType;
      if (unaryExpr.op === '-' || unaryExpr.op === '+' || unaryExpr.op === '~') return this.ctx.typeContext.numberType;
    }
    if (e.type === 'type_assertion') {
      const assertion = expr as TypeAssertionNode;
      if (assertion.assertedType) {
        return this.ctx.typeContext.resolve(stripNullable(assertion.assertedType));
      }
    }
    if (e.type === 'call') {
      const callExpr = expr as CallNode;
      if (callExpr.name === 'String') return this.ctx.typeContext.stringType;
      if (callExpr.name === 'Number') return this.ctx.typeContext.numberType;
      if (callExpr.name === 'Boolean') return this.ctx.typeContext.booleanType;
      if (callExpr.name === 'fetch') return this.ctx.typeContext.resolve('Promise');
      if (callExpr.name === '__ts_node_type' || callExpr.name === '__ts_node_text') return this.ctx.typeContext.stringType;
      if (callExpr.name) {
        const func = this.getFunction(callExpr.name);
        if (func) {
          if (func.async) return this.ctx.typeContext.resolve('Promise');
          if (func.returnType) return this.ctx.typeContext.resolve(stripNullable(func.returnType));
        }
      }
    }
    if (e.type === 'this') {
      const className = this.ctx.getCurrentClassName();
      if (className) return this.ctx.typeContext.getClassType(className);
    }
    return null;
  }

  private resolveVariableType(name: string): ResolvedType | null {
    if (this.ctx.symbolTable.isString(name)) return this.ctx.typeContext.stringType;
    if (this.ctx.symbolTable.isNumberArray(name)) return this.ctx.typeContext.getArrayType('number');
    if (this.ctx.symbolTable.isMap(name)) return this.ctx.typeContext.getMapType('string', 'string');
    if (this.ctx.symbolTable.isSet(name)) return this.ctx.typeContext.getSetType('string');
    if (this.ctx.symbolTable.isRegex(name)) return this.ctx.typeContext.resolve('RegExp');
    if (this.ctx.symbolTable.isObject(name)) return this.ctx.typeContext.resolve('object');
    if (this.ctx.symbolTable.isJSON(name)) return this.ctx.typeContext.resolve('object');
    if (this.ctx.symbolTable.isClass(name)) {
      const className = this.ctx.symbolTable.getClassName(name);
      if (className) return this.ctx.typeContext.getClassType(className);
    }
    if (this.ctx.symbolTable.isObjectArray(name)) return this.ctx.typeContext.getArrayType('object');
    const varType = this.ctx.symbolTable.getType(name);
    if (varType) {
      if (varType === 'i8*') {
        const ifaceType = this.ctx.symbolTable.getInterfaceType(name);
        if (ifaceType && ifaceType.length > 0) return this.ctx.typeContext.getInterfaceType(ifaceType);
        return this.ctx.typeContext.stringType;
      }
      if (varType === 'double') return this.ctx.typeContext.numberType;
      if (varType === '%Array*' || varType === '%Array') return this.ctx.typeContext.getArrayType('number');
      if (varType === '%StringArray*' || varType === '%StringArray') return this.ctx.typeContext.getArrayType('string');
      if (varType === '%ObjectArray*') return this.ctx.typeContext.getArrayType('object');
      if (varType === '%Promise*') return this.ctx.typeContext.resolve('Promise');
      if (varType === '%__FetchResponse*') return this.ctx.typeContext.resolve('Response');
      if (varType === '%StringMap*') return this.ctx.typeContext.getMapType('string', 'string');
      if (varType === '%StringSet*') return this.ctx.typeContext.getSetType('string');
      if (varType.startsWith('%') && varType.endsWith('*')) {
        const typeName = varType.substring(1, varType.length - 1);
        if (this.getInterface(typeName)) return this.ctx.typeContext.getInterfaceType(typeName);
        if (this.getClass(typeName)) return this.ctx.typeContext.getClassType(typeName);
      }
    }
    const paramType = this.getParameterType(name);
    if (paramType) {
      return this.ctx.typeContext.resolve(stripNullable(paramType));
    }
    return null;
  }

  private getInterface(name: string): InterfaceDeclaration | null {
    const result = this.ctx.typeResolverGetInterface(name);
    if (result) {
      return result;
    }
    const ast = this.ctx.getAst();
    if (!ast || !ast.interfaces) return null;
    for (let i = 0; i < ast.interfaces.length; i++) {
      const iface = ast.interfaces[i] as InterfaceDeclaration;
      if (iface.name === name) {
        return iface;
      }
    }
    return null;
  }

  private getInterfaceProperty(interfaceName: string, propName: string): InterfaceField | null {
    if (!interfaceName || !propName) {
      return null;
    }
    const result = this.ctx.typeResolverGetInterfaceProperty(interfaceName, propName);
    if (result) {
      return result;
    }
    const iface = this.getInterface(interfaceName);
    if (!iface) return null;
    for (let i = 0; i < iface.fields.length; i++) {
      const f = iface.fields[i] as { name: string; type: string };
      let fieldName = f.name;
      if (fieldName.endsWith('?')) {
        fieldName = fieldName.slice(0, -1);
      }
      if (fieldName === propName) {
        return f;
      }
    }
    return null;
  }

  private getInterfaceMethodReturnType(interfaceName: string, methodName: string): string | null {
    const baseType = interfaceName.replace(/ \| null$/, '').replace(/ \| undefined$/, '').trim();
    const iface = this.getInterface(baseType);
    if (!iface || !iface.methods) return null;
    for (let i = 0; i < iface.methods.length; i++) {
      const m = iface.methods[i];
      if (m.name === methodName) {
        return m.returnType;
      }
    }
    return null;
  }

  private getFunction(name: string): FunctionNode | null {
    const ast = this.ctx.getAst();
    if (!ast || !ast.functions) return null;
    for (let i = 0; i < ast.functions.length; i++) {
      const func = ast.functions[i];
      if (func.name === name) {
        return func;
      }
    }
    return null;
  }

  private getClass(name: string): ClassNode | null {
    if (!name) return null;
    if (name.length === 0) return null;
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) return null;
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      if (!cls) continue;
      if (!cls.name) continue;
      if (cls.name === name) {
        return cls;
      }
    }
    return null;
  }

  private getClassMethod(className: string, methodName: string): ClassMethod | null {
    let cls = this.getClass(className);
    while (cls) {
      for (let i = 0; i < cls.methods.length; i++) {
        const method = cls.methods[i];
        if (!method) continue;
        if (!method.name) continue;
        if (method.name === methodName && !method.isConstructor) {
          return method;
        }
      }
      if (cls.extends) {
        cls = this.getClass(cls.extends);
      } else {
        cls = null;
      }
    }
    return null;
  }

  private getParameterType(paramName: string): string | null {
    const currentFunc = this.ctx.getCurrentFunction();
    if (!currentFunc) return null;
    const func = this.getFunction(currentFunc);
    if (func && func.parameters) {
      for (let i = 0; i < func.parameters.length; i++) {
        const p = func.parameters[i] as { name: string; type?: string };
        if (p.name === paramName && p.type) {
          return p.type;
        }
      }
    }
    const className = this.ctx.getCurrentClassName();
    if (className) {
      const method = this.getClassMethod(className, currentFunc);
      if (method && method.paramTypes) {
        for (let i = 0; i < method.params.length; i++) {
          if (method.params[i] === paramName && method.paramTypes[i]) {
            return method.paramTypes[i];
          }
        }
      }
    }
    return null;
  }

  private resolveClassNameFromExpression(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === 'this') {
      return this.ctx.getCurrentClassName();
    }
    if (e.type === 'variable') {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        return this.ctx.symbolTable.getClassName(varName) || null;
      }
      return null;
    }
    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      const objectType = this.resolveTypeFromExpression(memberExpr.object);
      if (!objectType) return null;
      const fieldType = this.getFieldTypeFromType(objectType, memberExpr.property);
      if (fieldType) {
        const baseFieldType = stripNullable(fieldType);
        const cls = this.getClass(baseFieldType);
        if (cls) return baseFieldType;
      }
      return null;
    }
    return null;
  }

  private resolveTypeFromExpression(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === 'this') {
      return this.ctx.getCurrentClassName();
    }
    if (e.type === 'variable') {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        return this.ctx.symbolTable.getClassName(varName) || null;
      }
      const interfaceType = this.ctx.symbolTable.getInterfaceType(varName);
      if (interfaceType) {
        return interfaceType;
      }
      return null;
    }
    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      const objectType = this.resolveTypeFromExpression(memberExpr.object);
      if (!objectType) return null;
      return this.getFieldTypeFromType(objectType, memberExpr.property);
    }
    if (e.type === 'type_assertion') {
      const assertion = expr as TypeAssertionNode;
      if (assertion.assertedType) {
        return assertion.assertedType;
      }
    }
    return null;
  }

  private getFieldTypeFromType(typeName: string, fieldName: string): string | null {
    if (!typeName) return null;
    if (!fieldName) return null;
    const cls = this.getClass(typeName);
    if (cls) {
      const fieldTsType = this.ctx.classGenGetFieldTsType(typeName, fieldName);
      if (fieldTsType) return fieldTsType;
    }
    const iface = this.getInterface(typeName);
    if (iface) {
      const field = this.getInterfaceProperty(typeName, fieldName);
      if (field) {
        const fieldTyped = field as { name: string; type: string };
        return fieldTyped.type;
      }
    }
    if (typeName.startsWith('{') && typeName.endsWith('}')) {
      const inlineField = this.getInlineObjectField(typeName, fieldName);
      if (inlineField) {
        return inlineField;
      }
    }
    return null;
  }

  private getInlineObjectField(typeStr: string, fieldName: string): string | null {
    const inner = typeStr.slice(1, typeStr.length - 1).trim();
    if (inner.length === 0) return null;
    const fields = this.parseInlineObjectFields(inner);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i] as { name: string; type: string };
      const cleanName = field.name.replace(/\?$/, '');
      if (cleanName === fieldName) {
        return field.type;
      }
    }
    return null;
  }

  private parseInlineObjectFields(inner: string): { name: string; type: string }[] {
    const fields: { name: string; type: string }[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '{' || ch === '(' || ch === '[' || ch === '<') {
        depth++;
      } else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') {
        depth--;
      } else if (ch === ';' && depth === 0) {
        const part = inner.slice(start, i).trim();
        if (part) {
          const colonIdx = part.indexOf(':');
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
      const colonIdx = lastPart.indexOf(':');
      if (colonIdx !== -1) {
        const name = lastPart.slice(0, colonIdx).trim();
        const fieldType = lastPart.slice(colonIdx + 1).trim();
        fields.push({ name, type: fieldType });
      }
    }
    return fields;
  }

  private resolveInterfaceTypeFromExpression(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === 'variable') {
      const varName = (expr as VariableNode).name;
      const varType = this.ctx.symbolTable.getType(varName);
      if (varType && varType.startsWith('%') && varType.endsWith('*')) {
        const typeName = varType.substring(1, varType.length - 1);
        if (this.getInterface(typeName)) {
          return typeName;
        }
      }
      return null;
    }
    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      const objectType = this.resolveTypeFromExpression(memberExpr.object);
      if (!objectType) return null;
      const fieldType = this.getFieldTypeFromType(objectType, memberExpr.property);
      if (fieldType) {
        const baseFieldType = fieldType.replace(/ \| null$/, '').replace(/ \| undefined$/, '').trim();
        if (this.getInterface(baseFieldType)) {
          return baseFieldType;
        }
      }
    }
    return null;
  }

  isBooleanExpression(expr: Expression | null | undefined): boolean {
    if (expr === null || expr === undefined) return false;
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === 'boolean') return true;
    return false;
  }

  isArrayExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    if (e.type === 'array') {
      return true;
    }
    if (e.type === 'binary') {
      const binExpr = expr as BinaryNode;
      if (binExpr.op === '||') {
        const leftIsArray = this.isArrayExpression(binExpr.left);
        const rightIsArray = this.isArrayExpression(binExpr.right);
        const rightBase = binExpr.right as ExprBase;
        if (leftIsArray && rightBase.type === 'array') {
          return true;
        }
        if (rightIsArray && leftIsArray) {
          return true;
        }
      }
    }
    if (e.type === 'variable') {
      const varExpr = expr as VariableNode;
      const isNumArr = this.ctx.symbolTable.isNumberArray(varExpr.name);
      const varType = this.ctx.symbolTable.getType(varExpr.name);
      if (isNumArr) {
        return true;
      }
      if (varType === '%Array*' || varType === '%Array') {
        return true;
      }
      return false;
    }
    if (e.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      if (methodExpr.method === 'filter' || methodExpr.method === 'map' || methodExpr.method === 'entries') {
        return true;
      }
      if (methodExpr.method === 'values') {
        const objBase = methodExpr.object as ExprBase;
        if (objBase.type !== 'variable' || (methodExpr.object as VariableNode).name !== 'Object') {
          return true;
        }
      }
      if (methodExpr.method === 'slice' || methodExpr.method === 'concat') {
        const objBase = methodExpr.object as ExprBase;
        if (objBase.type === 'array') {
          return true;
        }
        if (objBase.type === 'variable') {
          const varName = (methodExpr.object as VariableNode).name;
          if (this.ctx.symbolTable.isNumberArray(varName)) {
            return true;
          }
          const varType = this.ctx.symbolTable.getType(varName);
          if (varType === '%Array*' || varType === '%Array') {
            return true;
          }
        }
      }
      const methodObjBase = methodExpr.object as ExprBase;
      if (methodObjBase.type === 'this') {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith('[]')) return true;
          }
        }
      }
      if (methodObjBase.type === 'variable' && this.ctx.symbolTable.isClass((methodExpr.object as VariableNode).name)) {
        const className = this.ctx.symbolTable.getClassName((methodExpr.object as VariableNode).name);
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith('[]')) return true;
          }
        }
      }
      return false;
    }
    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      if (!memberExpr.object) {
        return false;
      }
      const objBase = memberExpr.object as ExprBase;
      if (!objBase.type) {
        return false;
      }
      if (objBase.type === 'variable' && this.ctx.symbolTable.isClass((memberExpr.object as VariableNode).name)) {
        const className = this.ctx.symbolTable.getClassName((memberExpr.object as VariableNode).name);
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType === 'number[]' || fieldType === 'boolean[]') {
            return true;
          }
        }
      }
      if (objBase.type === 'this') {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType === 'number[]' || fieldType === 'boolean[]') {
            return true;
          }
        }
      }
      if (objBase.type === 'variable') {
        const varName = (memberExpr.object as VariableNode).name;
        const paramType = this.getParameterType(varName);
        if (paramType) {
          const fieldType = this.getFieldTypeFromType(paramType, memberExpr.property);
          if (fieldType && fieldType.endsWith('[]')) {
            return true;
          }
        }
        const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType && ifaceType.length > 0) {
          const fieldType = this.getFieldTypeFromType(ifaceType, memberExpr.property);
          if (fieldType && fieldType.endsWith('[]')) {
            return true;
          }
        }
      }
    }
    return false;
  }

  isObjectExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === 'object') return true;
    return false;
  }

  isObjectArrayExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    if (e.type === 'binary') {
      const binExpr = expr as BinaryNode;
      if (binExpr.op === '||') {
        const rightBase = binExpr.right as ExprBase;
        if (rightBase.type === 'array') {
          return this.isObjectArrayExpression(binExpr.left);
        }
      }
    }
    if (e.type === 'variable') {
      const varName = (expr as VariableNode).name;
      const varType = this.ctx.symbolTable.getType(varName);
      if (varType === '%ObjectArray*') {
        return true;
      }
      if (varType === 'i8*') {
        if (this.ctx.symbolTable.isObjectArray(varName)) {
          return true;
        }
      }
    }
    if (e.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      const methodObjBase = methodExpr.object as ExprBase;
      if (methodObjBase.type === 'this') {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith('[]') && rt !== 'string[]' && rt !== 'number[]' && rt !== 'boolean[]') {
              return true;
            }
          }
        }
      }
      if (methodObjBase.type === 'variable') {
        const varName = (methodExpr.object as VariableNode).name;
        let className: string | null = null;
        if (this.ctx.symbolTable.isClass(varName)) {
          className = this.ctx.symbolTable.getClassName(varName) || null;
        } else {
          const paramType = this.getParameterType(varName);
          if (paramType) {
            className = paramType;
          }
        }
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith('[]') && rt !== 'string[]' && rt !== 'number[]' && rt !== 'boolean[]') {
              return true;
            }
          }
        }
      }
      if (methodExpr.method === 'slice' || methodExpr.method === 'concat' || methodExpr.method === 'filter') {
        if (this.isObjectArrayExpression(methodExpr.object)) {
          return true;
        }
      }
    }
    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      if (!memberExpr.object) {
        return false;
      }
      const objBase = memberExpr.object as ExprBase;
      if (!objBase.type) {
        return false;
      }
      if (objBase.type === 'variable' && this.ctx.symbolTable.isClass((memberExpr.object as VariableNode).name)) {
        const className = this.ctx.symbolTable.getClassName((memberExpr.object as VariableNode).name);
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType && fieldType.endsWith('[]') && fieldType !== 'string[]' && fieldType !== 'number[]' && fieldType !== 'boolean[]') {
            return true;
          }
          const tsType = this.ctx.classGenGetFieldTsType(className, memberExpr.property);
          if (tsType && tsType.endsWith('[]') && tsType !== 'string[]' && tsType !== 'number[]' && tsType !== 'boolean[]') {
            return true;
          }
        }
      }
      if (objBase.type === 'this') {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType && fieldType.endsWith('[]') && fieldType !== 'string[]' && fieldType !== 'number[]' && fieldType !== 'boolean[]') {
            return true;
          }
          const tsType = this.ctx.classGenGetFieldTsType(className, memberExpr.property);
          if (tsType && tsType.endsWith('[]') && tsType !== 'string[]' && tsType !== 'number[]' && tsType !== 'boolean[]') {
            return true;
          }
        }
      }
      if (objBase.type === 'variable') {
        const varName = (memberExpr.object as VariableNode).name;
        const paramType = this.getParameterType(varName);
        if (paramType) {
          const fieldType = this.getFieldTypeFromType(paramType, memberExpr.property);
          if (fieldType && fieldType.endsWith('[]') && fieldType !== 'string[]' && fieldType !== 'number[]' && fieldType !== 'boolean[]') {
            return true;
          }
        }
        const ifaceType2 = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType2 && ifaceType2.length > 0) {
          const fieldType = this.getFieldTypeFromType(ifaceType2, memberExpr.property);
          if (fieldType && fieldType.endsWith('[]') && fieldType !== 'string[]' && fieldType !== 'number[]' && fieldType !== 'boolean[]') {
            return true;
          }
        }
        const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
        if (objMeta && objMeta.keys) {
          for (let ki = 0; ki < objMeta.keys.length; ki++) {
            if (objMeta.keys[ki] === memberExpr.property && objMeta.types[ki]) {
              const ft = objMeta.types[ki];
              if (ft.endsWith('[]') && ft !== 'string[]' && ft !== 'number[]' && ft !== 'boolean[]') {
                return true;
              }
            }
          }
        }
      }
      if (objBase.type === 'member_access') {
        const nestedMember = memberExpr.object as MemberAccessNode;
        const nestedObjBase = nestedMember.object as ExprBase;
        if (nestedObjBase.type === 'this') {
          const className = this.ctx.getCurrentClassName();
          if (className) {
            const fieldTsType = this.ctx.classGenGetFieldTsType(className, nestedMember.property);
            if (fieldTsType) {
              const fieldType = this.getFieldTypeFromType(fieldTsType, memberExpr.property);
              if (fieldType && fieldType.endsWith('[]') && fieldType !== 'string[]' && fieldType !== 'number[]' && fieldType !== 'boolean[]') {
                return true;
              }
            }
          }
        }
        const nestedType = this.resolveNestedMemberAccessTsType(nestedMember);
        if (nestedType) {
          const fieldType = this.getFieldTypeFromType(nestedType, memberExpr.property);
          if (fieldType && fieldType.endsWith('[]') && fieldType !== 'string[]' && fieldType !== 'number[]' && fieldType !== 'boolean[]') {
            return true;
          }
        }
      }
      if (objBase.type === 'type_assertion') {
        const assertion = memberExpr.object as TypeAssertionNode;
        if (assertion.assertedType) {
          const fieldType = this.getFieldTypeFromType(assertion.assertedType, memberExpr.property);
          if (fieldType && fieldType.endsWith('[]') && fieldType !== 'string[]' && fieldType !== 'number[]' && fieldType !== 'boolean[]') {
            return true;
          }
        }
      }
    }
    return false;
  }

  getObjectArrayElementType(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === 'binary') {
      const binExpr = expr as BinaryNode;
      if (binExpr.op === '||') {
        return this.getObjectArrayElementType(binExpr.left);
      }
    }
    if (e.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      const methodObjBase = methodExpr.object as ExprBase;
      if (methodObjBase.type === 'this') {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith('[]') && rt !== 'string[]' && rt !== 'number[]' && rt !== 'boolean[]') {
              return rt.slice(0, -2);
            }
          }
        }
      }
      if (methodObjBase.type === 'variable') {
        const varName = (methodExpr.object as VariableNode).name;
        let className: string | null = null;
        if (this.ctx.symbolTable.isClass(varName)) {
          className = this.ctx.symbolTable.getClassName(varName) || null;
        } else {
          const paramType = this.getParameterType(varName);
          if (paramType) {
            className = paramType;
          }
        }
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith('[]') && rt !== 'string[]' && rt !== 'number[]' && rt !== 'boolean[]') {
              return rt.slice(0, -2);
            }
          }
        }
      }
    }
    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      if (!memberExpr.object) {
        return null;
      }
      const objBase = memberExpr.object as ExprBase;
      if (!objBase.type) {
        return null;
      }
      if (objBase.type === 'variable') {
        const varName = (memberExpr.object as VariableNode).name;
        const paramType = this.getParameterType(varName);
        if (paramType) {
          const fieldType = this.getFieldTypeFromType(paramType, memberExpr.property);
          if (fieldType && fieldType.endsWith('[]') && fieldType !== 'string[]' && fieldType !== 'number[]' && fieldType !== 'boolean[]') {
            return fieldType.slice(0, -2);
          }
        }
        const ifaceType3 = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType3 && ifaceType3.length > 0) {
          const fieldType = this.getFieldTypeFromType(ifaceType3, memberExpr.property);
          if (fieldType && fieldType.endsWith('[]') && fieldType !== 'string[]' && fieldType !== 'number[]' && fieldType !== 'boolean[]') {
            return fieldType.slice(0, -2);
          }
        }
      }
      const objectType = this.resolveTypeFromExpression(memberExpr.object);
      if (objectType) {
        const fieldType = this.getFieldTypeFromType(objectType, memberExpr.property);
        if (fieldType) {
          const baseFieldType = stripNullable(fieldType);
          if (baseFieldType.endsWith('[]') && baseFieldType !== 'string[]' && baseFieldType !== 'number[]' && baseFieldType !== 'boolean[]') {
            return baseFieldType.slice(0, -2);
          }
        }
      }
    }
    return null;
  }

  isMapExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base.startsWith('Map<')) return true;
    return false;
  }

  isSetExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base.startsWith('Set<')) return true;
    return false;
  }

  isStringExpression(expr: Expression): boolean {
    if (!expr) {
      return false;
    }
    const e = expr as ExprBase;
    if (!e.type) {
      return false;
    }
    if (e.type === 'string') {
      return true;
    }
    if (e.type === 'template_literal') {
      return true;
    }
    if (e.type === 'unary' && (expr as UnaryNode).op === 'typeof') {
      return true;
    }
    if (e.type === 'type_assertion') {
      const assertion = expr as TypeAssertionNode;
      if (assertion.assertedType === 'string') {
        return true;
      }
      return this.isStringExpression(assertion.expression);
    }
    if (e.type === 'call') {
      const callExpr = expr as CallNode;
      if (callExpr.name === '__ts_node_type' || callExpr.name === '__ts_node_text') {
        return true;
      }
    }
    if (e.type === 'variable') {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isString(varName)) {
        return true;
      }
      const varType = this.ctx.symbolTable.getType(varName);
      if (varType === 'i8*') {
        if (this.ctx.symbolTable.isClass(varName) || this.ctx.symbolTable.isObject(varName)) {
          return false;
        }
        const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType && ifaceType.length > 0) {
          return false;
        }
        return true;
      }
      return false;
    }
    if (e.type === 'binary') {
      const binaryExpr = expr as BinaryNode;
      if (binaryExpr.op === '+') {
        return this.isStringExpression(binaryExpr.left) || this.isStringExpression(binaryExpr.right);
      }
      if (binaryExpr.op === '||') {
        return this.isStringExpression(binaryExpr.left) || this.isStringExpression(binaryExpr.right);
      }
    }
    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      if (!memberExpr.object) {
        return false;
      }
      const objBase = memberExpr.object as ExprBase;
      if (!objBase.type) {
        return false;
      }
      if (objBase.type === 'variable') {
        const varName = (memberExpr.object as VariableNode).name;
        if (varName === 'process' && memberExpr.property === 'platform') {
          return true;
        }
        if (varName === 'process' && (memberExpr.property === 'arch' || memberExpr.property === 'version' || memberExpr.property === 'execPath' || memberExpr.property === 'argv0')) {
          return true;
        }
        const propType = this.ctx.symbolTable.getObjectPropertyType(varName, memberExpr.property);
        if (propType === 'i8*') {
          return true;
        }
        const varType = this.ctx.symbolTable.getType(varName);
        if (varType && varType.startsWith('%') && varType.endsWith('*') &&
            varType.indexOf('Array') === -1 && varType.indexOf('Response') === -1 &&
            varType.indexOf('Map') === -1 && varType.indexOf('Set') === -1) {
          const structTypeName = varType.substring(1, varType.length - 1);
          const prop = this.getInterfaceProperty(structTypeName, memberExpr.property);
          if (prop && isStringType(prop.type)) {
            return true;
          }
        }
        const ifaceType4 = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType4 && ifaceType4.length > 0) {
          const prop = this.getInterfaceProperty(ifaceType4, memberExpr.property);
          if (prop && isStringType(prop.type)) {
            return true;
          }
        }
        if (this.ctx.symbolTable.isClass(varName)) {
          const className = this.ctx.symbolTable.getClassName(varName);
          if (className) {
            const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
            if (fieldType === 'string') {
              return true;
            }
          }
        }
      }
      if (objBase.type === 'this') {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType === 'string') {
            return true;
          }
        }
      }
      if (objBase.type === 'type_assertion') {
        const assertExpr = memberExpr.object as TypeAssertionNode;
        const assertedType = assertExpr.assertedType;
        const prop = this.getInterfaceProperty(assertedType, memberExpr.property);
        if (prop && isStringType(prop.type)) {
          return true;
        }
      }
      if (objBase.type === 'member_access') {
        const nestedMemberEnv = memberExpr.object as MemberAccessNode;
        const nestedObjBaseEnv = nestedMemberEnv.object as ExprBase;
        if (nestedObjBaseEnv.type === 'variable' &&
            (nestedMemberEnv.object as VariableNode).name === 'process' &&
            nestedMemberEnv.property === 'env') {
          return true;
        }
        const nestedMemberTsType = this.resolveNestedMemberAccessTsType(memberExpr.object as MemberAccessNode);
        if (nestedMemberTsType) {
          const fieldProp = this.getInterfaceProperty(nestedMemberTsType, memberExpr.property);
          if (fieldProp && isStringType(fieldProp.type)) {
            return true;
          }
        } else {
          const nestedMember = memberExpr.object as MemberAccessNode;
          if (nestedMember.property === 'classMetadata' && memberExpr.property === 'className') {
            return true;
          }
        }
      }
    }
    if (e.type === 'index_access') {
      const indexExpr = expr as IndexAccessNode;
      const idxObjBase = indexExpr.object as ExprBase;
      if (idxObjBase.type === 'member_access') {
        const memberAccess = indexExpr.object as MemberAccessNode;
        const memberObjBase = memberAccess.object as ExprBase;
        if (memberObjBase.type === 'variable' &&
            (memberAccess.object as VariableNode).name === 'process' &&
            memberAccess.property === 'argv') {
          return true;
        }
      }
      if (idxObjBase.type === 'variable') {
        const varName = (indexExpr.object as VariableNode).name;
        const varType = this.ctx.symbolTable.getType(varName);
        if (varType === '%StringArray*' || varType === '%StringArray') {
          return true;
        }
        if (varType === 'i8*') {
          if (((this.ctx.symbolTable.isObject(varName) || this.ctx.symbolTable.isJSON(varName)) && this.ctx.symbolTable.getObjectMetadataKeys(varName) !== undefined) || this.ctx.symbolTable.getInterfaceType(varName)) {
            return false;
          }
          return true;
        }
      }
      if (idxObjBase.type === 'member_access') {
        const memberAccess = indexExpr.object as MemberAccessNode;
        const memberObjBase = memberAccess.object as ExprBase;
        if (memberObjBase.type === 'this') {
          const className = this.ctx.getCurrentClassName();
          if (className) {
            const fieldType = this.ctx.classGenGetFieldType(className, memberAccess.property);
            if (fieldType === 'string[]') {
              return true;
            }
          }
        }
        if (memberObjBase.type === 'variable' && this.ctx.symbolTable.isClass((memberAccess.object as VariableNode).name)) {
          const className = this.ctx.symbolTable.getClassName((memberAccess.object as VariableNode).name);
          if (className) {
            const fieldType = this.ctx.classGenGetFieldType(className, memberAccess.property);
            if (fieldType === 'string[]') {
              return true;
            }
          }
        }
      }
    }
    if (e.type === 'call') {
      const funcExpr = expr as CallNode;
      if (funcExpr.name === 'String') {
        return true;
      }
      if (funcExpr.name) {
        const func = this.getFunction(funcExpr.name);
        if (func && func.returnType === 'string') {
          return true;
        }
      }
    }
    if (e.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      const methodObjBase = methodExpr.object as ExprBase;
      if (methodObjBase.type === 'variable' &&
          (methodExpr.object as VariableNode).name === 'fs' &&
          methodExpr.method === 'readFileSync') {
        return true;
      }
      const stringPathMethods = ['resolve', 'dirname', 'join', 'basename', 'normalize', 'extname', 'relative'];
      if (methodObjBase.type === 'variable' &&
          (methodExpr.object as VariableNode).name === 'path' &&
          stringPathMethods.indexOf(methodExpr.method) !== -1) {
        return true;
      }
      if (methodObjBase.type === 'variable' &&
          (methodExpr.object as VariableNode).name === 'JSON' &&
          methodExpr.method === 'stringify') {
        return true;
      }
      if (methodObjBase.type === 'variable' &&
          (methodExpr.object as VariableNode).name === 'crypto' &&
          (methodExpr.method === 'sha256' || methodExpr.method === 'md5' || methodExpr.method === 'sha512' || methodExpr.method === 'randomBytes')) {
        return true;
      }
      if (methodObjBase.type === 'variable' &&
          (methodExpr.object as VariableNode).name === 'sqlite' &&
          methodExpr.method === 'get') {
        return true;
      }
      if (methodExpr.method === 'substr' || methodExpr.method === 'substring' ||
          methodExpr.method === 'repeat' ||
          methodExpr.method === 'padStart' || methodExpr.method === 'charAt' ||
          methodExpr.method === 'trim' || methodExpr.method === 'trimStart' || methodExpr.method === 'trimEnd' ||
          methodExpr.method === 'replace' || methodExpr.method === 'replaceAll' ||
          methodExpr.method === 'toUpperCase' || methodExpr.method === 'toLowerCase' ||
          methodExpr.method === 'toString' ||
          methodExpr.method === 'text' || methodExpr.method === 'getVariableType') {
        return true;
      }
      if ((methodExpr.method === 'slice' || methodExpr.method === 'concat') &&
          !this.isArrayExpression(methodExpr.object) && !this.isStringArrayExpression(methodExpr.object)) {
        return true;
      }
      if (methodObjBase.type === 'variable' && this.ctx.symbolTable.isClass((methodExpr.object as VariableNode).name)) {
        const className = this.ctx.symbolTable.getClassName((methodExpr.object as VariableNode).name);
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            if (this.returnTypeIsString(method.returnType)) {
              return true;
            }
          }
        }
      }
      if (methodObjBase.type === 'this') {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            if (this.returnTypeIsString(method.returnType)) {
              return true;
            }
          }
        }
      }
      if (methodObjBase.type === 'member_access') {
        const memberAccess = methodExpr.object as MemberAccessNode;
        const fieldClassName = this.resolveClassNameFromExpression(memberAccess);
        if (fieldClassName) {
          const method = this.getClassMethod(fieldClassName, methodExpr.method);
          if (method && method.returnType) {
            if (this.returnTypeIsString(method.returnType)) {
              return true;
            }
          }
        }
        const interfaceType = this.resolveInterfaceTypeFromExpression(memberAccess);
        if (interfaceType) {
          const methodReturnType = this.getInterfaceMethodReturnType(interfaceType, methodExpr.method);
          if (methodReturnType && this.returnTypeIsString(methodReturnType)) {
            return true;
          }
        }
      }
      if (methodExpr.method === 'get' && methodObjBase.type === 'variable' &&
          this.ctx.symbolTable.isMap((methodExpr.object as VariableNode).name)) {
        const mapMeta = this.ctx.symbolTable.getMapMetadata((methodExpr.object as VariableNode).name);
        if (mapMeta && mapMeta.valueType === 'string') {
          return true;
        }
      }
      if (methodExpr.method === 'get' && methodObjBase.type === 'member_access') {
        const memberAccess = methodExpr.object as MemberAccessNode;
        const memberAccessObjBase = memberAccess.object as ExprBase;
        if (memberAccessObjBase.type === 'this' && this.ctx.getCurrentClassName() && this.ctx.hasClassGen()) {
          const fieldInfoResult = this.ctx.classGenGetFieldInfo(this.ctx.getCurrentClassName(), memberAccess.property);
          const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
          if (fieldInfoResult && fieldInfo.tsType) {
            const mapParsed = parseMapTypeString(fieldInfo.tsType);
            if (mapParsed && mapParsed.keyType === 'string' && mapParsed.valueType === 'string') {
              return true;
            }
          }
        }
      }
    }
    if (e.type === 'conditional') {
      const condExpr = expr as ConditionalExpressionNode;
      return this.isStringExpression(condExpr.consequent) || this.isStringExpression(condExpr.alternate);
    }
    return false;
  }

  isRegexExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === 'RegExp') return true;
    return false;
  }

  isClassInstanceExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved) {
      if (resolved.base === 'Promise' || resolved.base === 'RegExp') return false;
      if (resolved.base === 'string' || resolved.base === 'number' || resolved.base === 'boolean' ||
          resolved.base === 'void' || resolved.base === 'null' || resolved.base === 'unknown' ||
          resolved.base === 'object' || resolved.base === 'Response') return false;
      if (resolved.base.startsWith('Map<') || resolved.base.startsWith('Set<')) return false;
      if (resolved.arrayDepth > 0) return false;
      const cls = this.getClass(resolved.base);
      if (cls) return true;
    }
    const e = expr as ExprBase;
    if (e.type === 'new') {
      const newExpr = expr as NewNode;
      if (newExpr.className === 'Promise') return false;
      if (newExpr.className === 'RegExp') return false;
      return true;
    }
    if (e.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      if (methodExpr.method === 'get') {
        const methodObjBase = methodExpr.object as ExprBase;
        if (methodObjBase.type === 'variable') {
          const varName = (methodExpr.object as VariableNode).name;
          if (this.ctx.symbolTable.isMap(varName)) {
            const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
            if (mapMeta && mapMeta.valueType && this.getClass(mapMeta.valueType)) {
              return true;
            }
          }
        } else if (methodObjBase.type === 'member_access') {
          const memberExpr = methodExpr.object as MemberAccessNode;
          const memberExprObjBase = memberExpr.object as ExprBase;
          if (memberExprObjBase.type === 'this' && this.ctx.getCurrentClassName() && this.ctx.hasClassGen()) {
            const fieldInfoResult = this.ctx.classGenGetFieldInfo(this.ctx.getCurrentClassName(), memberExpr.property);
            const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
            if (fieldInfoResult && fieldInfo.tsType) {
              const mapParsed = parseMapTypeString(fieldInfo.tsType);
              if (mapParsed && mapParsed.valueType && this.getClass(mapParsed.valueType)) {
                return true;
              }
            }
          }
        }
      }
    }
    return false;
  }

  isPromiseExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === 'Promise') return true;
    const e = expr as ExprBase;
    if (e.type === 'call' && (expr as CallNode).name === 'fetch') {
      return true;
    }
    if (e.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      const objBase = methodExpr.object as ExprBase;
      if (objBase.type === 'variable' && (methodExpr.object as VariableNode).name === 'Promise') {
        return true;
      }
      if (methodExpr.method === 'then' || methodExpr.method === 'catch') {
        return this.isPromiseExpression(methodExpr.object);
      }
    }
    if (e.type === 'call') {
      const func = this.getFunction((expr as CallNode).name);
      if (func && func.async) {
        return true;
      }
    }
    return false;
  }

  isResponseExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === 'Response') return true;
    return false;
  }

  getTypedJsonInterface(expr: MethodCallNode): string | null {
    const e = expr as ExprBase;
    if (e.type === 'method_call' && expr.method === 'json' && expr.typeParameter) {
      return expr.typeParameter;
    }
    return null;
  }

  getFunctionCallInterfaceReturn(expr: Expression): string | null {
    const e = expr as ExprBase;

    if (e.type === 'conditional') {
      const condExpr = expr as ConditionalExpressionNode;
      const consequentResult = this.getFunctionCallInterfaceReturn(condExpr.consequent);
      if (consequentResult) return consequentResult;
      const alternateResult = this.getFunctionCallInterfaceReturn(condExpr.alternate);
      if (alternateResult) return alternateResult;
      return null;
    }

    if (e.type !== 'call') return null;
    const callExpr = expr as CallNode;
    const func = this.getFunction(callExpr.name);
    if (!func || !func.returnType) return null;

    let returnType = func.returnType;

    if (returnType.indexOf(' | ') !== -1) {
      const parts = returnType.split(' | ');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part !== 'null' && part !== 'undefined') {
          if (part.startsWith('{')) {
            return part;
          }
          const iface = this.getInterface(part);
          if (iface) return part;
        }
      }
    }

    if (returnType.startsWith('{')) {
      return returnType;
    }

    const iface = this.getInterface(returnType);
    if (iface) return returnType;
    return null;
  }

  getIndexAccessElementType(expr: Expression): string | null {
    let e = expr as ExprBase;
    let indexExpr: Expression = expr;
    if (e.type === 'type_assertion') {
      const assertion = expr as { expression: Expression; assertedType: string };
      if (assertion.expression) {
        indexExpr = assertion.expression;
        e = assertion.expression as ExprBase;
      }
    }
    if (e.type !== 'index_access') return null;
    const idxNode = indexExpr as IndexAccessNode;
    const objBase = idxNode.object as ExprBase;
    if (objBase.type === 'variable') {
      const varName = (idxNode.object as VariableNode).name;
      const objMeta5 = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objMeta5 && objMeta5.tsTypes) {
        return null;
      }
      const ifaceType5 = this.ctx.symbolTable.getInterfaceType(varName);
      if (ifaceType5) {
        const baseType = ifaceType5.replace('[]', '');
        const iface = this.getInterface(baseType);
        if (iface) return baseType;
      }
      const objArrElemType = this.ctx.symbolTable.getRawInterfaceType(varName);
      if (objArrElemType) {
        const iface = this.getInterface(objArrElemType);
        if (iface) return objArrElemType;
      }
    }
    return null;
  }

  getMethodCallInterfaceReturn(expr: Expression): string | null {
    const e = expr as ExprBase;

    if (e.type === 'type_assertion') {
      const assertion = expr as TypeAssertionNode;
      if (assertion.assertedType.startsWith('{')) {
        return assertion.assertedType;
      }
      const iface = this.getInterface(assertion.assertedType);
      if (iface) return assertion.assertedType;
      return this.getMethodCallInterfaceReturn(assertion.expression);
    }

    if (e.type === 'conditional') {
      const condExpr = expr as ConditionalExpressionNode;
      const consequentResult = this.getMethodCallInterfaceReturn(condExpr.consequent);
      if (consequentResult) return consequentResult;
      const alternateResult = this.getMethodCallInterfaceReturn(condExpr.alternate);
      if (alternateResult) return alternateResult;
      return null;
    }

    if (e.type !== 'method_call') return null;
    const methodExpr = expr as MethodCallNode;

    const className = this.resolveClassNameFromExpression(methodExpr.object);

    if (className) {
      const method = this.getClassMethod(className, methodExpr.method);
      if (method && method.returnType) {
        let returnType = method.returnType;
        if (returnType.indexOf(' | ') !== -1) {
          const parts = returnType.split(' | ');
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            if (part !== 'null' && part !== 'undefined') {
              if (part.startsWith('{') && !part.endsWith('[]')) {
                return part;
              }
              const iface = this.getInterface(part);
              if (iface) return part;
            }
          }
        }

        if (returnType.startsWith('{') && !stripNullable(returnType).endsWith('[]')) {
          return returnType;
        }

        const iface = this.getInterface(returnType);
        if (iface) return returnType;
      }
    }

    const interfaceType = this.resolveInterfaceTypeFromExpression(methodExpr.object);
    if (interfaceType) {
      const methodReturnType = this.getInterfaceMethodReturnType(interfaceType, methodExpr.method);
      if (methodReturnType) {
        let returnType = methodReturnType;
        if (returnType.indexOf(' | ') !== -1) {
          const parts = returnType.split(' | ');
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            if (part !== 'null' && part !== 'undefined') {
              if (part.startsWith('{') && !part.endsWith('[]')) {
                return part;
              }
              const iface = this.getInterface(part);
              if (iface) return part;
            }
          }
        }

        if (returnType.startsWith('{') && !stripNullable(returnType).endsWith('[]')) {
          return returnType;
        }

        const iface = this.getInterface(returnType);
        if (iface) return returnType;
      }
    }

    return null;
  }

  getMethodCallArrayReturn(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type !== 'method_call') return null;
    const methodExpr = expr as MethodCallNode;

    const className = this.resolveClassNameFromExpression(methodExpr.object);

    if (className) {
      const method = this.getClassMethod(className, methodExpr.method);
      if (method && method.returnType) {
        const rt = stripNullable(method.returnType);
        if (rt.endsWith('[]')) {
          const elementTypeName = rt.slice(0, -2).trim();
          if (elementTypeName === 'string' || elementTypeName === 'number' || elementTypeName === 'boolean') {
            return null;
          }
          return elementTypeName;
        }
      }
    }

    return null;
  }

  private parseInlineObjectType(typeStr: string): { name: string; type: string }[] | null {
    if (!typeStr.startsWith('{') || !typeStr.endsWith('}')) {
      return null;
    }
    const inner = typeStr.slice(1, typeStr.length - 1).trim();
    if (inner.length === 0) {
      return [];
    }
    const fields: { name: string; type: string }[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '{' || ch === '(' || ch === '[' || ch === '<') {
        depth++;
      } else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') {
        depth--;
      } else if (ch === ';' && depth === 0) {
        const part = inner.slice(start, i).trim();
        if (part) {
          const colonIdx = part.indexOf(':');
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
      const colonIdx = lastPart.indexOf(':');
      if (colonIdx !== -1) {
        const name = lastPart.slice(0, colonIdx).trim();
        const fieldType = lastPart.slice(colonIdx + 1).trim();
        fields.push({ name, type: fieldType });
      }
    }
    return fields;
  }

  getJSONParseInterface(expr: MethodCallNode): string | null {
    const e = expr as ExprBase;
    if (e.type === 'method_call' &&
        expr.method === 'parse' &&
        expr.object !== null &&
        expr.object !== undefined) {
      const exprObj = expr.object as ExprBase;
      if (exprObj.type === 'variable' &&
          (expr.object as VariableNode).name === 'JSON' &&
          expr.typeParameter) {
        return expr.typeParameter;
      }
    }
    return null;
  }

  isJSONParseExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    if (e.type === 'method_call') {
      const methodCall = expr as MethodCallNode;
      const objBase = methodCall.object as ExprBase;
      return methodCall.method === 'parse' &&
             objBase.type === 'variable' &&
             (methodCall.object as VariableNode).name === 'JSON';
    }
    if (e.type === 'variable') {
      return this.ctx.symbolTable.isJSON((expr as VariableNode).name);
    }
    return false;
  }

  isStringArrayExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    if (e.type === 'binary') {
      const binExpr = expr as BinaryNode;
      if (binExpr.op === '||') {
        const leftIsStringArray = this.isStringArrayExpression(binExpr.left);
        const rightBase = binExpr.right as ExprBase;
        if (leftIsStringArray && rightBase.type === 'array') {
          return true;
        }
        if (leftIsStringArray && this.isStringArrayExpression(binExpr.right)) {
          return true;
        }
      }
    }
    if (e.type === 'type_assertion') {
      const assertion = expr as TypeAssertionNode;
      if (assertion.assertedType === 'string[]') {
        return true;
      }
      return this.isStringArrayExpression(assertion.expression);
    }
    if (e.type === 'variable') {
      const varType = this.ctx.symbolTable.getType((expr as VariableNode).name);
      if (varType === '%StringArray*' || varType === '%StringArray') {
        return true;
      }
      return false;
    }
    if (e.type === 'array') {
      const arrayExpr = expr as ArrayNode;
      const elements = arrayExpr.elements || [];
      if (elements.length === 0 && this.ctx.getExpectedArrayElementType() === 'string') {
        return true;
      }
      if (elements.length === 0) {
        return false;
      }
      for (let i = 0; i < elements.length; i++) {
        const elem = elements[i];
        const elemBase = elem as ExprBase;
        if (elemBase.type === 'string') {
          continue;
        }
        if (elemBase.type === 'variable') {
          const varName = (elem as VariableNode).name;
          if (this.ctx.symbolTable.isString(varName)) {
            continue;
          }
          const varType = this.ctx.symbolTable.getType(varName);
          if (varType === 'i8*') {
            continue;
          }
          return false;
        }
        if (this.isStringExpression(elem)) {
          continue;
        }
        return false;
      }
      return true;
    }
    if (e.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      if (methodExpr.method === 'split') {
        return true;
      }
      if (methodExpr.method === 'all') {
        const objBase = methodExpr.object as ExprBase;
        if (objBase.type === 'variable' && (methodExpr.object as VariableNode).name === 'sqlite') {
          return true;
        }
      }
      if (methodExpr.method === 'keys') {
        const objBase = methodExpr.object as ExprBase;
        if (objBase.type === 'variable' && (methodExpr.object as VariableNode).name === 'Object') {
          return true;
        }
      }
      if (methodExpr.method === 'values' || methodExpr.method === 'entries') {
        const objBase = methodExpr.object as ExprBase;
        if (objBase.type === 'variable' && (methodExpr.object as VariableNode).name === 'Object') {
          if (methodExpr.method === 'entries') {
            return true;
          }
          if (methodExpr.args.length > 0) {
            const argBase = methodExpr.args[0] as ExprBase;
            if (argBase.type === 'variable') {
              const argName = (methodExpr.args[0] as VariableNode).name;
              const objInfo = this.ctx.symbolTable.getObjectInfo(argName);
              if (objInfo) {
                const allNumbers = objInfo.types.every((t: string) => t === 'double');
                if (!allNumbers) return true;
              }
            }
          }
        }
      }
      if (methodExpr.method === 'match' && this.isStringExpression(methodExpr.object) && !this.isClassInstanceExpression(methodExpr.object)) {
        if (methodExpr.args.length > 0 && (methodExpr.args[0].type === 'regex' || this.isRegexExpression(methodExpr.args[0]))) {
          return true;
        }
      }
      if (methodExpr.method === 'exec' && this.isRegexExpression(methodExpr.object)) {
        return true;
      }
      if (methodExpr.method === 'map' || methodExpr.method === 'filter' || methodExpr.method === 'slice' || methodExpr.method === 'concat') {
        return this.isStringArrayExpression(methodExpr.object);
      }
      const objBase = methodExpr.object as ExprBase;
      if (objBase.type === 'this') {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType === 'string[]') {
            return true;
          }
        }
      }
      if (objBase.type === 'variable' && this.ctx.symbolTable.isClass((methodExpr.object as VariableNode).name)) {
        const className = this.ctx.symbolTable.getClassName((methodExpr.object as VariableNode).name);
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType === 'string[]') {
            return true;
          }
        }
      }
      return false;
    }
    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      if (!memberExpr.object) {
        return false;
      }
      const objBase = memberExpr.object as ExprBase;
      if (!objBase.type) {
        return false;
      }
      if (objBase.type === 'variable' &&
          (memberExpr.object as VariableNode).name === 'process' &&
          memberExpr.property === 'argv') {
        return true;
      }
      if (objBase.type === 'variable' && this.ctx.symbolTable.isClass((memberExpr.object as VariableNode).name)) {
        const className = this.ctx.symbolTable.getClassName((memberExpr.object as VariableNode).name);
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType === 'string[]') {
            return true;
          }
        }
      }
      if (objBase.type === 'variable') {
        const varName = (memberExpr.object as VariableNode).name;
        const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType) {
          const prop = this.getInterfaceProperty(ifaceType, memberExpr.property);
          if (prop && prop.type === 'string[]') {
            return true;
          }
        }
      }
      if (objBase.type === 'variable' && this.ctx.symbolTable.isObject((memberExpr.object as VariableNode).name)) {
        const varName = (memberExpr.object as VariableNode).name;
        const objInfo = this.ctx.symbolTable.getObjectInfo(varName);
        if (objInfo && objInfo.tsTypes) {
          const propIdx = objInfo.keys.indexOf(memberExpr.property);
          if (propIdx >= 0 && objInfo.tsTypes[propIdx] === 'string[]') {
            return true;
          }
        }
      }
      if (objBase.type === 'this') {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType === 'string[]') {
            return true;
          }
        }
      }
      if (objBase.type === 'member_access') {
        const nestedMemberTsType = this.resolveNestedMemberAccessTsType(memberExpr.object as MemberAccessNode);
        if (nestedMemberTsType) {
          const fieldProp = this.getInterfaceProperty(nestedMemberTsType, memberExpr.property);
          if (fieldProp && fieldProp.type === 'string[]') {
            return true;
          }
          if (!fieldProp && nestedMemberTsType.endsWith('Metadata') &&
              (memberExpr.property === 'keys' || memberExpr.property === 'types' || memberExpr.property === 'tsTypes')) {
            return true;
          }
        } else {
          const nestedMember = memberExpr.object as MemberAccessNode;
          if (nestedMember.property === 'objectMetadata' &&
              (memberExpr.property === 'keys' || memberExpr.property === 'types' || memberExpr.property === 'tsTypes')) {
            return true;
          }
        }
      }
      if (objBase.type === 'type_assertion') {
        const assertion = memberExpr.object as TypeAssertionNode;
        if (assertion.assertedType) {
          const fieldType = this.getFieldTypeFromType(assertion.assertedType, memberExpr.property);
          if (fieldType === 'string[]') {
            return true;
          }
        }
      }
    }
    if (e.type === 'call') {
      const funcExpr = expr as CallNode;
      if (funcExpr.name) {
        const func = this.getFunction(funcExpr.name);
        if (func && func.returnType) {
          let normalizedRetType = func.returnType;
          if (normalizedRetType.indexOf(' | ') !== -1) {
            normalizedRetType = normalizedRetType.replace(' | undefined', '').replace(' | null', '').trim();
          }
          if (normalizedRetType === 'string[]') {
            return true;
          }
        }
      }
    }
    return false;
  }

  private resolveNestedMemberAccessTsType(memberExpr: MemberAccessNode): string | null {
    const objBase = memberExpr.object as ExprBase;
    if (objBase.type === 'variable') {
      const varName = (memberExpr.object as VariableNode).name;
      if (this.ctx.symbolTable.isObject(varName)) {
        const objInfo = this.ctx.symbolTable.getObjectInfo(varName);
        if (objInfo && objInfo.tsTypes) {
          const propIdx = objInfo.keys.indexOf(memberExpr.property);
          if (propIdx >= 0) {
            return objInfo.tsTypes[propIdx];
          }
        }
      }
      if (this.ctx.symbolTable.isClass(varName)) {
        const className = this.ctx.symbolTable.getClassName(varName);
        if (className) {
          return this.ctx.classGenGetFieldTsType(className, memberExpr.property);
        }
      }
      const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
      if (ifaceType) {
        const prop = this.getInterfaceProperty(ifaceType, memberExpr.property);
        if (prop) {
          return prop.type;
        }
      }
    }
    if (objBase.type === 'this') {
      const className = this.ctx.getCurrentClassName();
      if (className) {
        return this.ctx.classGenGetFieldTsType(className, memberExpr.property);
      }
    }
    if (objBase.type === 'member_access') {
      const nestedType = this.resolveNestedMemberAccessTsType(memberExpr.object as MemberAccessNode);
      if (nestedType) {
        const prop = this.getInterfaceProperty(nestedType, memberExpr.property);
        if (prop) {
          return prop.type;
        }
      }
    }
    return null;
  }

  private returnTypeIsString(returnType: string): boolean {
    if (returnType === 'string') return true;
    if (returnType.indexOf(' | ') !== -1) {
      const parts = returnType.split(' | ');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part === 'string') return true;
        if (part !== 'undefined' && part !== 'null' && this.isStringEnum(part)) return true;
      }
    }
    if (this.isStringEnum(returnType)) return true;
    return false;
  }

  private isStringEnum(typeName: string): boolean {
    return false;
  }
}
