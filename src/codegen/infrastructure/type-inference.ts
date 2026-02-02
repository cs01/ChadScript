import { Expression, MethodCallNode, AST, MemberAccessNode, IndexAccessNode, CallNode, ArrayNode, NewNode, FunctionNode, ClassNode, ClassMethod, VariableNode, ConditionalExpressionNode, InterfaceDeclaration, InterfaceField, BinaryNode } from '../../ast/types.js';
import { SymbolTable } from './symbol-table.js';
import type { TypeChecker } from '../../typescript/type-checker.js';
import type { ClassGenerator } from '../types/objects/class.js';

export interface TypeInferenceContext {
  symbolTable: SymbolTable;
  expectedArrayElementType: 'string' | 'number' | 'boolean' | null;
  currentClassName: string | null;
  currentFunction: string;
  ast: AST;
  typeChecker: TypeChecker | null;
  classGen: ClassGenerator | null;
}

export class TypeInference {
  constructor(private ctx: TypeInferenceContext) {}

  private getInterface(name: string): InterfaceDeclaration | null {
    if (!this.ctx.ast.interfaces) return null;
    for (let i = 0; i < this.ctx.ast.interfaces.length; i++) {
      if (this.ctx.ast.interfaces[i].name === name) {
        return this.ctx.ast.interfaces[i];
      }
    }
    return null;
  }

  private getInterfaceProperty(interfaceName: string, propName: string): InterfaceField | null {
    const iface = this.getInterface(interfaceName);
    if (!iface) return null;
    for (let i = 0; i < iface.fields.length; i++) {
      if (iface.fields[i].name === propName) {
        return iface.fields[i];
      }
    }
    return null;
  }

  private getFunction(name: string): FunctionNode | null {
    if (!this.ctx.ast.functions) return null;
    for (let i = 0; i < this.ctx.ast.functions.length; i++) {
      const func = this.ctx.ast.functions[i];
      if (func.name === name) {
        return func;
      }
    }
    return null;
  }

  private getClass(name: string): ClassNode | null {
    if (!this.ctx.ast.classes) return null;
    for (let i = 0; i < this.ctx.ast.classes.length; i++) {
      const cls = this.ctx.ast.classes[i];
      if (cls.name === name) {
        return cls;
      }
    }
    return null;
  }

  private getClassMethod(className: string, methodName: string): ClassMethod | null {
    const cls = this.getClass(className);
    if (!cls) return null;
    for (let i = 0; i < cls.methods.length; i++) {
      const method = cls.methods[i];
      if (method.name === methodName && !method.isConstructor) {
        return method;
      }
    }
    return null;
  }

  private resolveClassNameFromExpression(expr: Expression): string | null {
    if (expr.type === 'this') {
      return this.ctx.currentClassName;
    }
    if (expr.type === 'variable') {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        return this.ctx.symbolTable.getClassName(varName) || null;
      }
      return null;
    }
    if (expr.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      const objectType = this.resolveTypeFromExpression(memberExpr.object);
      if (!objectType) return null;
      const fieldType = this.getFieldTypeFromType(objectType, memberExpr.property);
      if (fieldType) {
        const cls = this.getClass(fieldType);
        if (cls) return fieldType;
      }
      return null;
    }
    return null;
  }

  private resolveTypeFromExpression(expr: Expression): string | null {
    if (expr.type === 'this') {
      return this.ctx.currentClassName;
    }
    if (expr.type === 'variable') {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        return this.ctx.symbolTable.getClassName(varName) || null;
      }
      return null;
    }
    if (expr.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      const objectType = this.resolveTypeFromExpression(memberExpr.object);
      if (!objectType) return null;
      return this.getFieldTypeFromType(objectType, memberExpr.property);
    }
    return null;
  }

  private getFieldTypeFromType(typeName: string, fieldName: string): string | null {
    const cls = this.getClass(typeName);
    if (cls) {
      const fieldTsType = this.ctx.classGen?.getFieldTsType(typeName, fieldName);
      if (fieldTsType) return fieldTsType;
    }
    const iface = this.getInterface(typeName);
    if (iface) {
      const field = this.getInterfaceProperty(typeName, fieldName);
      if (field) return field.type;
    }
    return null;
  }

  isBooleanExpression(expr: Expression | null | undefined): boolean {
    if (expr === null || expr === undefined) return false;
    if (expr.type === 'boolean') return true;
    return false;
  }

  isArrayExpression(expr: Expression): boolean {
    if (expr.type === 'array') {
      return true;
    }
    if (expr.type === 'variable') {
      const varExpr = expr as VariableNode;
      if (this.ctx.symbolTable.isNumberArray(varExpr.name)) {
        return true;
      }
      const varType = this.ctx.symbolTable.getType(varExpr.name);
      if (varType === '%Array*') {
        return true;
      }
      return false;
    }
    if (expr.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      return methodExpr.method === 'filter' || methodExpr.method === 'map' || methodExpr.method === 'entries' || methodExpr.method === 'values';
    }
    if (expr.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      if (memberExpr.object.type === 'variable' && this.ctx.symbolTable.isClass((memberExpr.object as VariableNode).name)) {
        const className = this.ctx.symbolTable.getClassName((memberExpr.object as VariableNode).name);
        if (className) {
          const fieldType = this.ctx.classGen?.getFieldType(className, memberExpr.property);
          if (fieldType === 'number[]' || fieldType === 'boolean[]') {
            return true;
          }
        }
      }
      if (memberExpr.object.type === 'this') {
        const className = this.ctx.currentClassName;
        if (className) {
          const fieldType = this.ctx.classGen?.getFieldType(className, memberExpr.property);
          if (fieldType === 'number[]' || fieldType === 'boolean[]') {
            return true;
          }
        }
      }
    }
    return false;
  }

  isObjectExpression(expr: Expression): boolean {
    if (expr.type === 'object') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isObject((expr as VariableNode).name);
    }
    return false;
  }

  isMapExpression(expr: Expression): boolean {
    if (expr.type === 'map') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isMap((expr as VariableNode).name);
    }
    return false;
  }

  isSetExpression(expr: Expression): boolean {
    if (expr.type === 'set') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isSet((expr as VariableNode).name);
    }
    return false;
  }

  isStringExpression(expr: Expression): boolean {
    if (expr.type === 'string') {
      return true;
    }
    if (expr.type === 'template_literal') {
      return true;
    }
    if (expr.type === 'call') {
      const callExpr = expr as CallNode;
      if (callExpr.name === '__ts_node_type' || callExpr.name === '__ts_node_text') {
        return true;
      }
    }
    if (expr.type === 'variable') {
      const varType = this.ctx.symbolTable.getType((expr as VariableNode).name);
      if (varType === 'i8*') {
        return true;
      }
      return false;
    }
    if (expr.type === 'binary') {
      const binaryExpr = expr as BinaryNode;
      if (binaryExpr.op === '+') {
        return this.isStringExpression(binaryExpr.left) || this.isStringExpression(binaryExpr.right);
      }
    }
    if (expr.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      if (memberExpr.object.type === 'variable') {
        const varName = (memberExpr.object as VariableNode).name;
        const propType = this.ctx.symbolTable.getObjectPropertyType(varName, memberExpr.property);
        if (propType === 'i8*') {
          return true;
        }
        const varType = this.ctx.symbolTable.getType(varName);
        if (varType && varType.startsWith('%') && varType.endsWith('*') &&
            !varType.includes('Array') && !varType.includes('Response') &&
            !varType.includes('Map') && !varType.includes('Set')) {
          const structTypeName = varType.substring(1, varType.length - 1);
          const prop = this.getInterfaceProperty(structTypeName, memberExpr.property);
          if (prop && prop.type === 'string') {
            return true;
          }
        }
        if (this.ctx.symbolTable.isClass(varName)) {
          const className = this.ctx.symbolTable.getClassName(varName);
          if (className) {
            const fieldType = this.ctx.classGen?.getFieldType(className, memberExpr.property);
            if (fieldType === 'string') {
              return true;
            }
          }
        }
      }
      if (memberExpr.object.type === 'this') {
        const className = this.ctx.currentClassName;
        if (className) {
          const fieldType = this.ctx.classGen?.getFieldType(className, memberExpr.property);
          if (fieldType === 'string') {
            return true;
          }
        }
      }
    }
    if (expr.type === 'index_access') {
      const indexExpr = expr as IndexAccessNode;
      if (indexExpr.object.type === 'member_access') {
        const memberAccess = indexExpr.object as MemberAccessNode;
        if (memberAccess.object.type === 'variable' &&
            (memberAccess.object as VariableNode).name === 'process' &&
            memberAccess.property === 'argv') {
          return true;
        }
      }
      if (indexExpr.object.type === 'variable') {
        const varName = (indexExpr.object as VariableNode).name;
        const varType = this.ctx.symbolTable.getType(varName);
        if (varType === '%StringArray*') {
          return true;
        }
      }
      if (indexExpr.object.type === 'member_access') {
        const memberAccess = indexExpr.object as MemberAccessNode;
        if (memberAccess.object.type === 'variable' && (memberAccess.object as VariableNode).name === 'this') {
          const className = this.ctx.currentClassName;
          if (className) {
            const fieldType = this.ctx.classGen?.getFieldType(className, memberAccess.property);
            if (fieldType === 'string[]') {
              return true;
            }
          }
        }
        if (memberAccess.object.type === 'variable' && this.ctx.symbolTable.isClass((memberAccess.object as VariableNode).name)) {
          const className = this.ctx.symbolTable.getClassName((memberAccess.object as VariableNode).name);
          if (className) {
            const fieldType = this.ctx.classGen?.getFieldType(className, memberAccess.property);
            if (fieldType === 'string[]') {
              return true;
            }
          }
        }
      }
    }
    if (expr.type === 'call') {
      const funcExpr = expr as CallNode;
      if (funcExpr.name === 'String') {
        return true;
      }
      const func = this.getFunction(funcExpr.name);
      if (func && func.returnType === 'string') {
        return true;
      }
    }
    if (expr.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      if (methodExpr.object.type === 'variable' &&
          (methodExpr.object as VariableNode).name === 'fs' &&
          methodExpr.method === 'readFileSync') {
        return true;
      }
      if (methodExpr.object.type === 'variable' &&
          (methodExpr.object as VariableNode).name === 'path' &&
          (methodExpr.method === 'resolve' || methodExpr.method === 'dirname')) {
        return true;
      }
      if (methodExpr.object.type === 'variable' &&
          (methodExpr.object as VariableNode).name === 'JSON' &&
          methodExpr.method === 'stringify') {
        return true;
      }
      if (methodExpr.method === 'substr' || methodExpr.method === 'substring' ||
          methodExpr.method === 'concat' || methodExpr.method === 'repeat' ||
          methodExpr.method === 'padStart' || methodExpr.method === 'charAt' ||
          methodExpr.method === 'trim' || methodExpr.method === 'slice' ||
          methodExpr.method === 'text') {
        return true;
      }
      if (methodExpr.object.type === 'variable' && this.ctx.symbolTable.isClass((methodExpr.object as VariableNode).name)) {
        const className = this.ctx.symbolTable.getClassName((methodExpr.object as VariableNode).name);
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType === 'string') {
            return true;
          }
        }
      }
      if (methodExpr.method === 'get' && methodExpr.object.type === 'variable' &&
          this.ctx.symbolTable.isMap((methodExpr.object as VariableNode).name)) {
        const mapMeta = this.ctx.symbolTable.getMapMetadata((methodExpr.object as VariableNode).name);
        if (mapMeta && mapMeta.valueType === 'string') {
          return true;
        }
      }
    }
    if (expr.type === 'conditional') {
      const condExpr = expr as ConditionalExpressionNode;
      return this.isStringExpression(condExpr.consequent) || this.isStringExpression(condExpr.alternate);
    }
    return false;
  }

  isRegexExpression(expr: Expression): boolean {
    if (expr.type === 'regex') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isRegex((expr as VariableNode).name);
    }
    return false;
  }

  isClassInstanceExpression(expr: Expression): boolean {
    if (expr.type === 'new') {
      const newExpr = expr as NewNode;
      if (newExpr.className === 'Promise') {
        return false;
      }
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isClass((expr as VariableNode).name);
    }
    return false;
  }

  isPromiseExpression(expr: Expression): boolean {
    if (expr.type === 'new' && (expr as NewNode).className === 'Promise') {
      return true;
    }
    if (expr.type === 'call' && (expr as CallNode).name === 'fetch') {
      return true;
    }
    if (expr.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      if (methodExpr.object.type === 'variable' && (methodExpr.object as VariableNode).name === 'Promise') {
        return true;
      }
      if (methodExpr.method === 'then' || methodExpr.method === 'catch') {
        return this.isPromiseExpression(methodExpr.object);
      }
    }
    if (expr.type === 'variable') {
      const varType = this.ctx.symbolTable.getType((expr as VariableNode).name);
      return varType === '%Promise*';
    }
    if (expr.type === 'call') {
      const func = this.getFunction((expr as CallNode).name);
      if (func && func.async) {
        return true;
      }
    }
    return false;
  }

  isResponseExpression(expr: Expression): boolean {
    if (expr.type === 'variable') {
      const varType = this.ctx.symbolTable.getType((expr as VariableNode).name);
      if (varType === '%Response*') {
        return true;
      }
    }
    return false;
  }

  getTypedJsonInterface(expr: MethodCallNode): string | null {
    if (expr.type === 'method_call' && expr.method === 'json' && expr.typeParameter) {
      return expr.typeParameter;
    }
    return null;
  }

  getFunctionCallInterfaceReturn(expr: Expression): string | null {
    if (expr.type !== 'call') return null;
    const callExpr = expr as CallNode;
    const func = this.getFunction(callExpr.name);
    if (!func || !func.returnType) return null;
    const iface = this.getInterface(func.returnType);
    if (iface) return func.returnType;
    return null;
  }

  getMethodCallInterfaceReturn(expr: Expression): string | null {
    if (expr.type !== 'method_call') return null;
    const methodExpr = expr as MethodCallNode;

    const className = this.resolveClassNameFromExpression(methodExpr.object);

    if (!className) return null;

    const method = this.getClassMethod(className, methodExpr.method);
    if (!method || !method.returnType) return null;

    let returnType = method.returnType;
    if (returnType.includes(' | ')) {
      const parts = returnType.split(' | ');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part !== 'null' && part !== 'undefined') {
          const iface = this.getInterface(part);
          if (iface) return part;
        }
      }
    }

    const iface = this.getInterface(returnType);
    if (iface) return returnType;

    return null;
  }

  getJSONParseInterface(expr: MethodCallNode): string | null {
    if (expr.type === 'method_call' &&
        expr.method === 'parse' &&
        expr.object?.type === 'variable' &&
        (expr.object as VariableNode)?.name === 'JSON' &&
        expr.typeParameter) {
      return expr.typeParameter;
    }
    return null;
  }

  isJSONParseExpression(expr: Expression): boolean {
    if (expr.type === 'method_call') {
      const methodCall = expr as MethodCallNode;
      return methodCall.method === 'parse' &&
             methodCall.object.type === 'variable' &&
             (methodCall.object as VariableNode).name === 'JSON';
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isJSON((expr as VariableNode).name);
    }
    return false;
  }

  isStringArrayExpression(expr: Expression): boolean {
    if (expr.type === 'variable') {
      const varType = this.ctx.symbolTable.getType((expr as VariableNode).name);
      if (varType === '%StringArray*') {
        return true;
      }
      return false;
    }
    if (expr.type === 'array') {
      const arrayExpr = expr as ArrayNode;
      const elements = arrayExpr.elements || [];
      if (elements.length === 0 && this.ctx.expectedArrayElementType === 'string') {
        return true;
      }
      return elements.length > 0 && elements.every((elem: Expression) => elem.type === 'string');
    }
    if (expr.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;
      return methodExpr.method === 'split';
    }
    if (expr.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      if (memberExpr.object.type === 'variable' &&
          (memberExpr.object as VariableNode).name === 'process' &&
          memberExpr.property === 'argv') {
        return true;
      }
      if (memberExpr.object.type === 'variable' && this.ctx.symbolTable.isClass((memberExpr.object as VariableNode).name)) {
        const className = this.ctx.symbolTable.getClassName((memberExpr.object as VariableNode).name);
        if (className) {
          const fieldType = this.ctx.classGen?.getFieldType(className, memberExpr.property);
          if (fieldType === 'string[]') {
            return true;
          }
        }
      }
      if (memberExpr.object.type === 'this') {
        const className = this.ctx.currentClassName;
        if (className) {
          const fieldType = this.ctx.classGen?.getFieldType(className, memberExpr.property);
          if (fieldType === 'string[]') {
            return true;
          }
        }
      }
    }
    return false;
  }
}
