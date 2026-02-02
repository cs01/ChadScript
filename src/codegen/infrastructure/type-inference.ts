import { Expression, MethodCallNode, AST, MemberAccessNode, IndexAccessNode, CallNode, ArrayNode, NewNode, FunctionNode, ClassNode, ClassMethod, VariableNode, ConditionalExpressionNode, InterfaceDeclaration } from '../../ast/types.js';
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
      if (this.ctx.symbolTable.isNumberArray(expr.name)) {
        return true;
      }
      const varType = this.ctx.symbolTable.getType(expr.name);
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
      if (memberExpr.object.type === 'variable' && this.ctx.symbolTable.isClass(memberExpr.object.name)) {
        const className = this.ctx.symbolTable.getClassName(memberExpr.object.name);
        if (className) {
          const fieldType = this.ctx.classGen?.getFieldType(className, memberExpr.property);
          if (fieldType === 'number[]' || fieldType === 'boolean[]') {
            return true;
          }
        }
      }
      if (memberExpr.object.type === 'this') {
        const classNode = this.ctx.ast.classes[0];
        if (classNode) {
          const fieldType = this.ctx.classGen?.getFieldType(classNode.name, memberExpr.property);
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
      return this.ctx.symbolTable.isObject(expr.name);
    }
    return false;
  }

  isMapExpression(expr: Expression): boolean {
    if (expr.type === 'map') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.ctx.symbolTable.isMap(expr.name);
    }
    return false;
  }

  isSetExpression(expr: Expression): boolean {
    if (expr.type === 'set') {
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
      const varType = this.ctx.symbolTable.getType(expr.name);
      if (varType === 'i8*') {
        return true;
      }
      return false;
    }
    if (expr.type === 'binary' && expr.op === '+') {
      return this.isStringExpression(expr.left) || this.isStringExpression(expr.right);
    }
    if (expr.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      if (memberExpr.object.type === 'variable') {
        const varName = memberExpr.object.name;
        const objMeta = this.ctx.symbolTable.getObjectInfo(varName);
        if (objMeta) {
          const propIndex = objMeta.keys.indexOf(memberExpr.property);
          if (propIndex >= 0 && objMeta.types[propIndex] === 'i8*') {
            return true;
          }
        }
        const varType = this.ctx.symbolTable.getType(varName);
        if (varType && varType.startsWith('%') && varType.endsWith('*') &&
            !varType.includes('Array') && !varType.includes('Response') &&
            !varType.includes('Map') && !varType.includes('Set')) {
          const structTypeName = varType.substring(1, varType.length - 1);
          if (this.ctx.typeChecker) {
            const interfaceDef = this.ctx.typeChecker.getInterfaceDefinition(structTypeName);
            if (interfaceDef) {
              const prop = interfaceDef.properties.find((p) => p.name === memberExpr.property);
              if (prop && prop.type === 'string') {
                return true;
              }
            }
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
        if (this.ctx.typeChecker && this.ctx.currentFunction && this.ctx.symbolTable.getAlloca(varName) !== undefined) {
          const typeInfo = this.ctx.typeChecker.getPropertyType(varName, memberExpr.property, this.ctx.currentFunction);
          if (typeInfo && typeInfo.llvmType === 'i8*') {
            return true;
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
            memberAccess.object.name === 'process' &&
            memberAccess.property === 'argv') {
          return true;
        }
      }
      if (indexExpr.object.type === 'variable') {
        const varName = indexExpr.object.name;
        const varType = this.ctx.symbolTable.getType(varName);
        if (varType === '%StringArray*') {
          return true;
        }
      }
      if (indexExpr.object.type === 'member_access') {
        const memberAccess = indexExpr.object as MemberAccessNode;
        if (memberAccess.object.type === 'variable' && memberAccess.object.name === 'this') {
          const className = this.ctx.currentClassName;
          if (className) {
            const fieldType = this.ctx.classGen?.getFieldType(className, memberAccess.property);
            if (fieldType === 'string[]') {
              return true;
            }
          }
        }
        if (memberAccess.object.type === 'variable' && this.ctx.symbolTable.isClass(memberAccess.object.name)) {
          const className = this.ctx.symbolTable.getClassName(memberAccess.object.name);
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
      const func = this.ctx.ast.functions?.find((f: FunctionNode) => f.name === funcExpr.name);
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
          const classNode = this.ctx.ast.classes.find((c: ClassNode) => c.name === className);
          if (classNode) {
            const method = classNode.methods.find((m: ClassMethod) => m.name === methodExpr.method && !m.isConstructor);
            if (method && method.returnType === 'string') {
              return true;
            }
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
      return this.ctx.symbolTable.isRegex(expr.name);
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
      return this.ctx.symbolTable.isClass(expr.name);
    }
    return false;
  }

  isPromiseExpression(expr: Expression): boolean {
    if (expr.type === 'new' && (expr as NewNode).className === 'Promise') {
      return true;
    }
    if (expr.type === 'call' && expr.name === 'fetch') {
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
      const varType = this.ctx.symbolTable.getType(expr.name);
      return varType === '%Promise*';
    }
    if (expr.type === 'call') {
      const func = this.ctx.ast.functions?.find((f: FunctionNode) => f.name === expr.name);
      if (func && func.async) {
        return true;
      }
    }
    return false;
  }

  isResponseExpression(expr: Expression): boolean {
    if (expr.type === 'variable') {
      const varType = this.ctx.symbolTable.getType(expr.name);
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
    const func = this.ctx.ast.functions.find((f: FunctionNode) => f.name === callExpr.name);
    if (!func || !func.returnType) return null;
    const iface = this.ctx.ast.interfaces?.find((i: InterfaceDeclaration) => i.name === func.returnType);
    if (iface) return func.returnType;
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
      return this.ctx.symbolTable.isJSON(expr.name);
    }
    return false;
  }

  isStringArrayExpression(expr: Expression): boolean {
    if (expr.type === 'variable') {
      const varType = this.ctx.symbolTable.getType(expr.name);
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
          memberExpr.object.name === 'process' &&
          memberExpr.property === 'argv') {
        return true;
      }
      if (memberExpr.object.type === 'variable' && this.ctx.symbolTable.isClass(memberExpr.object.name)) {
        const className = this.ctx.symbolTable.getClassName(memberExpr.object.name);
        if (className) {
          const fieldType = this.ctx.classGen?.getFieldType(className, memberExpr.property);
          if (fieldType === 'string[]') {
            return true;
          }
        }
      }
      if (memberExpr.object.type === 'this') {
        const classNode = this.ctx.ast.classes[0];
        if (classNode) {
          const fieldType = this.ctx.classGen?.getFieldType(classNode.name, memberExpr.property);
          if (fieldType === 'string[]') {
            return true;
          }
        }
      }
    }
    return false;
  }
}
