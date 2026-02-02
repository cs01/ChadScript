import { Expression, VariableNode, BinaryNode, MemberAccessNode, IndexAccessNode, MethodCallNode, CallNode, ArrayNode, ObjectNode, StringNode, NumberNode, BooleanNode, TypeAssertionNode, ConditionalExpressionNode } from '../../ast/types.js';
import { ResolvedType, createResolvedType, parseTypeString } from './type-system.js';
import { SymbolTable } from './symbol-table.js';
import type { TypeResolver } from './type-resolver/index.js';

interface ExprBase { type: string; }

export interface ExpressionTypeContext {
  symbolTable: SymbolTable;
  typeResolver?: TypeResolver;
  currentClassName?: string | null;
  expressionTypes: Map<Expression, ResolvedType>;
  classGen?: { getFieldTsType(className: string, fieldName: string): string | undefined };
}

export function inferExpressionType(expr: Expression, ctx: ExpressionTypeContext): ResolvedType | undefined {
  const cached = ctx.expressionTypes.get(expr);
  if (cached) return cached;

  const result = computeExpressionType(expr, ctx);
  if (result) {
    ctx.expressionTypes.set(expr, result);
  }
  return result;
}

function computeExpressionType(expr: Expression, ctx: ExpressionTypeContext): ResolvedType | undefined {
  const e = expr as ExprBase;

  switch (e.type) {
    case 'number':
      return createResolvedType('number');

    case 'string':
      return createResolvedType('string');

    case 'boolean':
      return createResolvedType('boolean');

    case 'null':
      return createResolvedType('null', { isNullable: true });

    case 'undefined':
      return createResolvedType('undefined', { isNullable: true });

    case 'array':
      return inferArrayType(expr as ArrayNode, ctx);

    case 'variable':
      return inferVariableType(expr as VariableNode, ctx);

    case 'binary':
      return inferBinaryType(expr as BinaryNode, ctx);

    case 'member_access':
      return inferMemberAccessType(expr as MemberAccessNode, ctx);

    case 'index_access':
      return inferIndexAccessType(expr as IndexAccessNode, ctx);

    case 'method_call':
      return inferMethodCallType(expr as MethodCallNode, ctx);

    case 'call':
      return inferCallType(expr as CallNode, ctx);

    case 'object':
      return createResolvedType('object');

    case 'type_assertion':
      return inferTypeAssertionType(expr as TypeAssertionNode, ctx);

    case 'conditional':
      return inferConditionalType(expr as ConditionalExpressionNode, ctx);

    case 'this':
      if (ctx.currentClassName) {
        return createResolvedType(ctx.currentClassName);
      }
      return undefined;

    case 'template_literal':
      return createResolvedType('string');

    default:
      return undefined;
  }
}

function inferArrayType(expr: ArrayNode, ctx: ExpressionTypeContext): ResolvedType {
  if (!expr.elements || expr.elements.length === 0) {
    return createResolvedType('unknown', {}, 1);
  }

  const firstElem = expr.elements[0];
  const firstElemBase = firstElem as ExprBase;

  if (firstElemBase.type === 'string') {
    return createResolvedType('string', {}, 1);
  }
  if (firstElemBase.type === 'number') {
    return createResolvedType('number', {}, 1);
  }
  if (firstElemBase.type === 'boolean') {
    return createResolvedType('boolean', {}, 1);
  }

  const elemType = inferExpressionType(firstElem, ctx);
  if (elemType) {
    return {
      ...elemType,
      arrayDepth: elemType.arrayDepth + 1
    };
  }

  return createResolvedType('unknown', {}, 1);
}

function inferVariableType(expr: VariableNode, ctx: ExpressionTypeContext): ResolvedType | undefined {
  const symbol = ctx.symbolTable.lookup(expr.name);
  if (!symbol) return undefined;

  if (symbol.interfaceType) {
    return parseTypeString(symbol.interfaceType);
  }

  const llvmType = symbol.llvmType;
  switch (llvmType) {
    case 'double': return createResolvedType('number');
    case 'i8*': return createResolvedType('string');
    case '%Array*': return createResolvedType('number', {}, 1);
    case '%StringArray*': return createResolvedType('string', {}, 1);
    case '%Map*': return createResolvedType('Map');
    case '%StringMap*': return createResolvedType('Map', {}, 0, [createResolvedType('string'), createResolvedType('unknown')]);
    case '%Set*': return createResolvedType('Set');
    case '%StringSet*': return createResolvedType('Set', {}, 0, [createResolvedType('string')]);
    default:
      if (llvmType.startsWith('%') && llvmType.endsWith('*')) {
        const name = llvmType.slice(1, -1);
        if (name.endsWith('_struct')) {
          return createResolvedType(name.slice(0, -7));
        }
        return createResolvedType(name);
      }
      return undefined;
  }
}

function inferBinaryType(expr: BinaryNode, ctx: ExpressionTypeContext): ResolvedType | undefined {
  const op = expr.op;

  if (op === '+') {
    const leftType = inferExpressionType(expr.left, ctx);
    const rightType = inferExpressionType(expr.right, ctx);

    if (leftType?.base === 'string' || rightType?.base === 'string') {
      return createResolvedType('string');
    }
    return createResolvedType('number');
  }

  if (op === '-' || op === '*' || op === '/' || op === '%') {
    return createResolvedType('number');
  }

  if (op === '==' || op === '===' || op === '!=' || op === '!==' ||
      op === '<' || op === '<=' || op === '>' || op === '>=' ||
      op === '&&' || op === '||') {
    return createResolvedType('boolean');
  }

  return createResolvedType('number');
}

function inferMemberAccessType(expr: MemberAccessNode, ctx: ExpressionTypeContext): ResolvedType | undefined {
  const objBase = expr.object as ExprBase;

  if (objBase.type === 'variable') {
    const varName = (expr.object as VariableNode).name;

    if (ctx.symbolTable.isObject(varName)) {
      const objInfo = ctx.symbolTable.getObjectInfo(varName);
      if (objInfo && objInfo.tsTypes) {
        const propIdx = objInfo.keys.indexOf(expr.property);
        if (propIdx >= 0) {
          return parseTypeString(objInfo.tsTypes[propIdx]);
        }
      }
    }

    if (ctx.symbolTable.isClass(varName)) {
      const className = ctx.symbolTable.getClassName(varName);
      if (className && ctx.classGen) {
        const fieldTsType = ctx.classGen.getFieldTsType(className, expr.property);
        if (fieldTsType) {
          return parseTypeString(fieldTsType);
        }
      }
    }

    const symbol = ctx.symbolTable.lookup(varName);
    if (symbol?.interfaceType && ctx.typeResolver) {
      const prop = ctx.typeResolver.getInterfaceProperty(symbol.interfaceType, expr.property);
      if (prop) {
        return parseTypeString(prop.type);
      }
    }
  }

  if (objBase.type === 'this' && ctx.currentClassName && ctx.classGen) {
    const fieldTsType = ctx.classGen.getFieldTsType(ctx.currentClassName, expr.property);
    if (fieldTsType) {
      return parseTypeString(fieldTsType);
    }
  }

  if (objBase.type === 'member_access') {
    const nestedType = inferMemberAccessType(expr.object as MemberAccessNode, ctx);
    if (nestedType && ctx.typeResolver) {
      const prop = ctx.typeResolver.getInterfaceProperty(nestedType.base, expr.property);
      if (prop) {
        return parseTypeString(prop.type);
      }
    }
  }

  return undefined;
}

function inferIndexAccessType(expr: IndexAccessNode, ctx: ExpressionTypeContext): ResolvedType | undefined {
  const objType = inferExpressionType(expr.object, ctx);
  if (!objType) return undefined;

  if (objType.arrayDepth > 0) {
    return {
      ...objType,
      arrayDepth: objType.arrayDepth - 1
    };
  }

  if (objType.base === 'string') {
    return createResolvedType('string');
  }

  return undefined;
}

function inferMethodCallType(expr: MethodCallNode, ctx: ExpressionTypeContext): ResolvedType | undefined {
  const method = expr.method;

  if (method === 'split' || method === 'match') {
    return createResolvedType('string', {}, 1);
  }

  if (method === 'join' || method === 'substring' || method === 'substr' ||
      method === 'slice' || method === 'trim' || method === 'toLowerCase' ||
      method === 'toUpperCase' || method === 'charAt' || method === 'concat') {
    return createResolvedType('string');
  }

  if (method === 'indexOf' || method === 'lastIndexOf' || method === 'length' ||
      method === 'charCodeAt') {
    return createResolvedType('number');
  }

  if (method === 'includes' || method === 'startsWith' || method === 'endsWith') {
    return createResolvedType('boolean');
  }

  if (method === 'push' || method === 'pop' || method === 'shift' || method === 'unshift') {
    return createResolvedType('number');
  }

  if (method === 'map' || method === 'filter') {
    const objType = inferExpressionType(expr.object, ctx);
    return objType;
  }

  if (method === 'get') {
    const objType = inferExpressionType(expr.object, ctx);
    if (objType?.base === 'Map' && objType.typeParams && objType.typeParams.length >= 2) {
      return { ...objType.typeParams[1], qualifiers: { ...objType.typeParams[1].qualifiers, isNullable: true } };
    }
  }

  return undefined;
}

function inferCallType(expr: CallNode, ctx: ExpressionTypeContext): ResolvedType | undefined {
  if (expr.name === 'String') {
    return createResolvedType('string');
  }
  if (expr.name === 'Number' || expr.name === 'parseInt' || expr.name === 'parseFloat') {
    return createResolvedType('number');
  }
  if (expr.name === 'Boolean') {
    return createResolvedType('boolean');
  }

  return undefined;
}

function inferTypeAssertionType(expr: TypeAssertionNode, ctx: ExpressionTypeContext): ResolvedType | undefined {
  if (expr.assertedType) {
    return parseTypeString(expr.assertedType);
  }
  return undefined;
}

function inferConditionalType(expr: ConditionalExpressionNode, ctx: ExpressionTypeContext): ResolvedType | undefined {
  const consequentType = inferExpressionType(expr.consequent, ctx);
  const alternateType = inferExpressionType(expr.alternate, ctx);

  if (consequentType && alternateType) {
    if (consequentType.base === alternateType.base) {
      return consequentType;
    }
    return createResolvedType('unknown', { isNullable: consequentType.qualifiers.isNullable || alternateType.qualifiers.isNullable });
  }

  return consequentType || alternateType;
}
