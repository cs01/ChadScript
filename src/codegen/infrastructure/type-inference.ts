import { Expression, MethodCallNode, AST } from '../../ast/types.js';
import { SymbolTable } from './symbol-table.js';

export interface TypeInferenceContext {
  symbolTable: SymbolTable;
  getVariableType(name: string): string | undefined;
  getVariableAlloca(name: string): string | undefined;
  expectedArrayElementType: 'string' | 'number' | 'boolean' | null;
  currentClassName: string | null;
  currentFunction: string;
  ast: AST;
  typeChecker: any;
  classGen: any;
}

export class TypeInference {
  constructor(private ctx: TypeInferenceContext) {}

  isBooleanExpression(expr: any): boolean {
    if (expr === null || expr === undefined) return false;
    if (expr.type === 'boolean') return true;
    if (expr.type === 'identifier' && (expr.name === 'true' || expr.name === 'false')) return true;
    return false;
  }

  isArrayExpression(expr: Expression): boolean {
    if (expr.type === 'array') {
      return true;
    }
    if (expr.type === 'variable') {
      if (this.ctx.symbolTable.isNumberArray(expr.name)) {
        return true;
      }
      const varType = this.ctx.getVariableType(expr.name);
      if (varType === '%Array*') {
        return true;
      }
      return false;
    }
    if (expr.type === 'method_call') {
      const method = (expr as any).method;
      return method === 'filter' || method === 'map';
    }
    if (expr.type === 'member_access') {
      const memberExpr = expr as any;
      if (memberExpr.object.type === 'variable' && this.ctx.symbolTable.isClass(memberExpr.object.name)) {
        const classMeta = this.ctx.symbolTable.getClassInfo(memberExpr.object.name)!;
        const fieldInfo = this.ctx.classGen?.getFieldInfo(classMeta.className, memberExpr.property);
        if (fieldInfo && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
          return true;
        }
      }
      if ((memberExpr.object as any).type === 'this') {
        const classNode = this.ctx.ast.classes.find((c: any) => true);
        if (classNode) {
          const fieldInfo = this.ctx.classGen?.getFieldInfo(classNode.name, memberExpr.property);
          if (fieldInfo && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
            return true;
          }
        }
      }
    }
    return false;
  }

  isObjectExpression(expr: Expression): boolean {
    if ((expr as any).type === 'object') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isObject(expr.name);
    }
    return false;
  }

  isMapExpression(expr: Expression): boolean {
    if ((expr as any).type === 'map') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isMap(expr.name);
    }
    return false;
  }

  isSetExpression(expr: Expression): boolean {
    if ((expr as any).type === 'set') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isSet(expr.name);
    }
    return false;
  }

  isStringExpression(expr: Expression): boolean {
    if (expr.type === 'string') {
      return true;
    }
    if ((expr as any).type === 'template_literal') {
      return true;
    }
    if (expr.type === 'variable') {
      const varType = this.ctx.getVariableType(expr.name);
      if (varType === 'i8*') {
        return true;
      }
      return false;
    }
    if (expr.type === 'binary' && expr.op === '+') {
      return this.isStringExpression(expr.left) || this.isStringExpression(expr.right);
    }
    if (expr.type === 'member_access') {
      const memberExpr = expr as any;
      if (memberExpr.object.type === 'variable') {
        const varName = memberExpr.object.name;
        const objMeta = this.ctx.symbolTable.getObjectInfo(varName);
        if (objMeta) {
          const propIndex = objMeta.keys.indexOf(memberExpr.property);
          if (propIndex >= 0 && objMeta.types[propIndex] === 'i8*') {
            return true;
          }
        }
        const varType = this.ctx.getVariableType(varName);
        if (varType && varType.startsWith('%') && varType.endsWith('*') &&
            !varType.includes('Array') && !varType.includes('Response') &&
            !varType.includes('Map') && !varType.includes('Set')) {
          const structTypeName = varType.substring(1, varType.length - 1);
          if (this.ctx.typeChecker) {
            const interfaceDef = this.ctx.typeChecker.getInterfaceDefinition(structTypeName);
            if (interfaceDef) {
              const prop = interfaceDef.properties.find((p: any) => p.name === memberExpr.property);
              if (prop && prop.type === 'string') {
                return true;
              }
            }
          }
        }
        if (this.ctx.symbolTable.isClass(varName)) {
          const classMeta = this.ctx.symbolTable.getClassInfo(varName)!;
          const fieldInfo = this.ctx.classGen?.getFieldInfo(classMeta.className, memberExpr.property);
          if (fieldInfo && fieldInfo.type === 'string') {
            return true;
          }
        }
        if (this.ctx.typeChecker && this.ctx.currentFunction && this.ctx.getVariableAlloca(varName) !== undefined) {
          const typeInfo = this.ctx.typeChecker.getPropertyType(varName, memberExpr.property, this.ctx.currentFunction);
          if (typeInfo && typeInfo.llvmType === 'i8*') {
            return true;
          }
        }
      }
      if (memberExpr.object.type === 'this') {
        const className = this.ctx.currentClassName || (this.ctx.classGen as any)?.currentClassName;
        if (className) {
          const fieldInfo = this.ctx.classGen?.getFieldInfo(className, memberExpr.property);
          if (fieldInfo && fieldInfo.type === 'string') {
            return true;
          }
        }
      }
    }
    if (expr.type === 'index_access') {
      const indexExpr = expr as any;
      if (indexExpr.object.type === 'member_access') {
        const memberAccess = indexExpr.object;
        if (memberAccess.object.type === 'variable' &&
            memberAccess.object.name === 'process' &&
            memberAccess.property === 'argv') {
          return true;
        }
      }
      if (indexExpr.object.type === 'variable') {
        const varName = indexExpr.object.name;
        const varType = this.ctx.getVariableType(varName);
        if (varType === '%StringArray*') {
          return true;
        }
      }
      if (indexExpr.object.type === 'member_access') {
        const memberAccess = indexExpr.object;
        if (memberAccess.object.type === 'variable' && memberAccess.object.name === 'this') {
          const className = this.ctx.currentClassName || (this.ctx.classGen as any)?.currentClassName;
          if (className) {
            const fieldInfo = this.ctx.classGen?.getFieldInfo(className, memberAccess.property);
            if (fieldInfo && fieldInfo.type === 'string[]') {
              return true;
            }
          }
        }
        if (memberAccess.object.type === 'variable' && this.ctx.symbolTable.isClass(memberAccess.object.name)) {
          const classMeta = this.ctx.symbolTable.getClassInfo(memberAccess.object.name)!;
          const fieldInfo = this.ctx.classGen?.getFieldInfo(classMeta.className, memberAccess.property);
          if (fieldInfo && fieldInfo.type === 'string[]') {
            return true;
          }
        }
      }
    }
    if (expr.type === 'call') {
      const funcExpr = expr as any;
      if (funcExpr.name === 'String') {
        return true;
      }
    }
    if (expr.type === 'method_call') {
      const methodExpr = expr as any as MethodCallNode;
      if (methodExpr.object.type === 'variable' &&
          (methodExpr.object as any).name === 'fs' &&
          methodExpr.method === 'readFileSync') {
        return true;
      }
      if (methodExpr.object.type === 'variable' &&
          (methodExpr.object as any).name === 'path' &&
          (methodExpr.method === 'resolve' || methodExpr.method === 'dirname')) {
        return true;
      }
      if (methodExpr.object.type === 'variable' &&
          (methodExpr.object as any).name === 'JSON' &&
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
      if (methodExpr.object.type === 'variable' && this.ctx.symbolTable.isClass(methodExpr.object.name)) {
        const classMeta = this.ctx.symbolTable.getClassInfo(methodExpr.object.name)!;
        const classNode = this.ctx.ast.classes.find((c: any) => c.name === classMeta.className);
        if (classNode) {
          const method = classNode.methods.find((m: any) => m.name === methodExpr.method && !m.isConstructor);
          if (method && method.returnType === 'string') {
            return true;
          }
        }
      }
      if (methodExpr.method === 'get' && methodExpr.object.type === 'variable' &&
          this.ctx.symbolTable.isMap(methodExpr.object.name)) {
        const mapMeta = this.ctx.symbolTable.getMapMetadata(methodExpr.object.name);
        if (mapMeta && mapMeta.valueType === 'string') {
          return true;
        }
      }
    }
    if ((expr as any).type === 'conditional') {
      const condExpr = expr as any;
      return this.isStringExpression(condExpr.consequent) || this.isStringExpression(condExpr.alternate);
    }
    return false;
  }

  isRegexExpression(expr: Expression): boolean {
    if ((expr as any).type === 'regex') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isRegex(expr.name);
    }
    return false;
  }

  isClassInstanceExpression(expr: Expression): boolean {
    if ((expr as any).type === 'new') {
      const className = (expr as any).className;
      if (className === 'Promise') {
        return false;
      }
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isClass(expr.name);
    }
    return false;
  }

  isPromiseExpression(expr: Expression): boolean {
    if ((expr as any).type === 'new' && (expr as any).className === 'Promise') {
      return true;
    }
    if (expr.type === 'call' && expr.name === 'fetch') {
      return true;
    }
    if (expr.type === 'method_call') {
      const methodExpr = expr as any;
      if (methodExpr.object.type === 'variable' && methodExpr.object.name === 'Promise') {
        return true;
      }
      if (methodExpr.method === 'then' || methodExpr.method === 'catch') {
        return this.isPromiseExpression(methodExpr.object);
      }
    }
    if (expr.type === 'variable') {
      const varType = this.ctx.getVariableType(expr.name);
      return varType === '%Promise*';
    }
    if (expr.type === 'call') {
      const func = this.ctx.ast.functions?.find((f: any) => f.name === expr.name);
      if (func && func.async) {
        return true;
      }
    }
    return false;
  }

  isResponseExpression(expr: Expression): boolean {
    if (expr.type === 'variable') {
      const varType = this.ctx.getVariableType(expr.name);
      if (varType === '%Response*') {
        return true;
      }
    }
    return false;
  }

  getTypedJsonInterface(expr: any): string | null {
    if (expr.type === 'method_call' && expr.method === 'json' && expr.typeParameter) {
      return expr.typeParameter;
    }
    return null;
  }

  getFunctionCallInterfaceReturn(expr: any): string | null {
    if (expr.type !== 'call') return null;
    const func = this.ctx.ast.functions.find((f: any) => f.name === expr.name);
    if (!func || !func.returnType) return null;
    const iface = this.ctx.ast.interfaces?.find((i: any) => i.name === func.returnType);
    if (iface) return func.returnType;
    return null;
  }

  getJSONParseInterface(expr: any): string | null {
    if (expr.type === 'method_call' &&
        expr.method === 'parse' &&
        expr.object?.type === 'variable' &&
        expr.object?.name === 'JSON' &&
        expr.typeParameter) {
      return expr.typeParameter;
    }
    return null;
  }

  isJSONParseExpression(expr: Expression): boolean {
    if (expr.type === 'method_call') {
      const methodCall = expr as any;
      return methodCall.method === 'parse' &&
             methodCall.object.type === 'variable' &&
             methodCall.object.name === 'JSON';
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isJSON(expr.name);
    }
    return false;
  }

  isStringArrayExpression(expr: Expression): boolean {
    if (expr.type === 'variable') {
      const varType = this.ctx.getVariableType(expr.name);
      if (varType === '%StringArray*') {
        return true;
      }
      return false;
    }
    if (expr.type === 'array') {
      const elements = (expr as any).elements || [];
      if (elements.length === 0 && this.ctx.expectedArrayElementType === 'string') {
        return true;
      }
      return elements.length > 0 && elements.every((elem: Expression) => elem.type === 'string');
    }
    if (expr.type === 'method_call') {
      const method = (expr as any).method;
      return method === 'split';
    }
    if (expr.type === 'member_access') {
      const memberExpr = expr as any;
      if (memberExpr.object.type === 'variable' &&
          memberExpr.object.name === 'process' &&
          memberExpr.property === 'argv') {
        return true;
      }
      if (memberExpr.object.type === 'variable' && this.ctx.symbolTable.isClass(memberExpr.object.name)) {
        const classMeta = this.ctx.symbolTable.getClassInfo(memberExpr.object.name)!;
        const fieldInfo = this.ctx.classGen?.getFieldInfo(classMeta.className, memberExpr.property);
        if (fieldInfo && fieldInfo.type === 'string[]') {
          return true;
        }
      }
      if ((memberExpr.object as any).type === 'this') {
        const classNode = this.ctx.ast.classes.find((c: any) => true);
        if (classNode) {
          const fieldInfo = this.ctx.classGen?.getFieldInfo(classNode.name, memberExpr.property);
          if (fieldInfo && fieldInfo.type === 'string[]') {
            return true;
          }
        }
      }
    }
    return false;
  }
}
