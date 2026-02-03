import * as ts from 'typescript';
import {
  Expression,
  Statement,
  NumberNode,
  StringNode,
  VariableNode,
  BinaryNode,
  UnaryNode,
  CallNode,
  MethodCallNode,
  MemberAccessNode,
  IndexAccessNode,
  ArrayNode,
  ObjectNode,
  NewNode,
  TemplateLiteralNode,
  ArrowFunctionNode,
  ConditionalExpressionNode,
  AwaitExpressionNode,
  RegexNode,
  MapNode,
  SetNode,
  BlockStatement,
  TypeAssertionNode,
} from '../../ast/types.js';
import { transformStatement, extractTypeString } from './statements.js';

export function transformExpression(node: ts.Expression, checker: ts.TypeChecker | undefined): Expression {
  switch (node.kind) {
    case ts.SyntaxKind.NumericLiteral:
      return transformNumericLiteral(node as ts.NumericLiteral);

    case ts.SyntaxKind.StringLiteral:
      return transformStringLiteral(node as ts.StringLiteral);

    case ts.SyntaxKind.TrueKeyword:
      return { type: 'boolean', value: true };

    case ts.SyntaxKind.FalseKeyword:
      return { type: 'boolean', value: false };

    case ts.SyntaxKind.NullKeyword:
      return { type: 'variable', name: 'null' };

    case ts.SyntaxKind.Identifier:
      return transformIdentifier(node as ts.Identifier);

    case ts.SyntaxKind.BinaryExpression:
      return transformBinaryExpression(node as ts.BinaryExpression, checker);

    case ts.SyntaxKind.PrefixUnaryExpression:
      return transformPrefixUnaryExpression(node as ts.PrefixUnaryExpression, checker);

    case ts.SyntaxKind.PostfixUnaryExpression:
      return transformPostfixUnaryExpression(node as ts.PostfixUnaryExpression, checker);

    case ts.SyntaxKind.CallExpression:
      return transformCallExpression(node as ts.CallExpression, checker);

    case ts.SyntaxKind.PropertyAccessExpression:
      return transformPropertyAccessExpression(node as ts.PropertyAccessExpression, checker);

    case ts.SyntaxKind.ElementAccessExpression:
      return transformElementAccessExpression(node as ts.ElementAccessExpression, checker);

    case ts.SyntaxKind.ArrayLiteralExpression:
      return transformArrayLiteral(node as ts.ArrayLiteralExpression, checker);

    case ts.SyntaxKind.ObjectLiteralExpression:
      return transformObjectLiteral(node as ts.ObjectLiteralExpression, checker);

    case ts.SyntaxKind.NewExpression:
      return transformNewExpression(node as ts.NewExpression, checker);

    case ts.SyntaxKind.ThisKeyword:
      return { type: 'this' };

    case ts.SyntaxKind.SuperKeyword:
      return { type: 'super' };

    case ts.SyntaxKind.TemplateExpression:
      return transformTemplateExpression(node as ts.TemplateExpression, checker);

    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return { type: 'string', value: (node as ts.NoSubstitutionTemplateLiteral).text };

    case ts.SyntaxKind.ArrowFunction:
      return transformArrowFunction(node as ts.ArrowFunction, checker);

    case ts.SyntaxKind.FunctionExpression:
      return transformFunctionExpression(node as ts.FunctionExpression, checker);

    case ts.SyntaxKind.ConditionalExpression:
      return transformConditionalExpression(node as ts.ConditionalExpression, checker);

    case ts.SyntaxKind.AwaitExpression:
      return transformAwaitExpression(node as ts.AwaitExpression, checker);

    case ts.SyntaxKind.ParenthesizedExpression:
      return transformExpression((node as ts.ParenthesizedExpression).expression, checker);

    case ts.SyntaxKind.RegularExpressionLiteral:
      return transformRegexLiteral(node as ts.RegularExpressionLiteral);

    case ts.SyntaxKind.TypeOfExpression:
      return transformTypeOfExpression(node as ts.TypeOfExpression, checker);

    case ts.SyntaxKind.AsExpression:
    case ts.SyntaxKind.TypeAssertionExpression:
      return transformTypeAssertion(node as ts.AsExpression, checker);

    case ts.SyntaxKind.NonNullExpression:
      return transformExpression((node as ts.NonNullExpression).expression, checker);

    default:
      throw new Error(`Unsupported expression kind: ${ts.SyntaxKind[node.kind]}`);
  }
}

export function transformExpressionStatement(node: ts.ExpressionStatement, checker: ts.TypeChecker | undefined): Expression {
  return transformExpression(node.expression, checker);
}

function transformNumericLiteral(node: ts.NumericLiteral): NumberNode {
  return { type: 'number', value: parseFloat(node.text) };
}

function transformStringLiteral(node: ts.StringLiteral): StringNode {
  return { type: 'string', value: node.text };
}

function transformIdentifier(node: ts.Identifier): VariableNode {
  return { type: 'variable', name: node.text };
}

function transformBinaryExpression(node: ts.BinaryExpression, checker: ts.TypeChecker | undefined): Expression {
  const left = transformExpression(node.left, checker);
  const right = transformExpression(node.right, checker);
  const op = getBinaryOperator(node.operatorToken.kind);

  if (isAssignmentOperator(node.operatorToken.kind)) {
    const compoundOp = getCompoundOperator(node.operatorToken.kind);
    if (compoundOp && node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
      const newRight: BinaryNode = { type: 'binary', op: compoundOp, left, right };
      return createAssignment(node.left, newRight, checker);
    }
    return createAssignment(node.left, right, checker);
  }

  return { type: 'binary', op, left, right };
}

function createAssignment(left: ts.Expression, value: Expression, checker: ts.TypeChecker | undefined): Expression {
  if (ts.isIdentifier(left)) {
    return { type: 'binary', op: '=', left: { type: 'variable', name: left.text }, right: value };
  } else if (ts.isPropertyAccessExpression(left)) {
    const obj = transformExpression(left.expression, checker);
    return {
      type: 'member_access_assignment',
      object: obj,
      property: left.name.text,
      value,
    };
  } else if (ts.isElementAccessExpression(left)) {
    const obj = transformExpression(left.expression, checker);
    const idx = transformExpression(left.argumentExpression, checker);
    return {
      type: 'index_access_assignment',
      object: obj,
      index: idx,
      value,
    };
  }
  throw new Error(`Cannot create assignment for ${ts.SyntaxKind[left.kind]}`);
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsToken ||
         kind === ts.SyntaxKind.PlusEqualsToken ||
         kind === ts.SyntaxKind.MinusEqualsToken ||
         kind === ts.SyntaxKind.AsteriskEqualsToken ||
         kind === ts.SyntaxKind.SlashEqualsToken ||
         kind === ts.SyntaxKind.BarEqualsToken ||
         kind === ts.SyntaxKind.AmpersandEqualsToken;
}

function getCompoundOperator(kind: ts.SyntaxKind): string | null {
  switch (kind) {
    case ts.SyntaxKind.PlusEqualsToken: return '+';
    case ts.SyntaxKind.MinusEqualsToken: return '-';
    case ts.SyntaxKind.AsteriskEqualsToken: return '*';
    case ts.SyntaxKind.SlashEqualsToken: return '/';
    case ts.SyntaxKind.BarEqualsToken: return '|';
    case ts.SyntaxKind.AmpersandEqualsToken: return '&';
    default: return null;
  }
}

function getBinaryOperator(kind: ts.SyntaxKind): string {
  switch (kind) {
    case ts.SyntaxKind.PlusToken: return '+';
    case ts.SyntaxKind.MinusToken: return '-';
    case ts.SyntaxKind.AsteriskToken: return '*';
    case ts.SyntaxKind.SlashToken: return '/';
    case ts.SyntaxKind.PercentToken: return '%';
    case ts.SyntaxKind.LessThanToken: return '<';
    case ts.SyntaxKind.GreaterThanToken: return '>';
    case ts.SyntaxKind.LessThanEqualsToken: return '<=';
    case ts.SyntaxKind.GreaterThanEqualsToken: return '>=';
    case ts.SyntaxKind.EqualsEqualsToken: return '==';
    case ts.SyntaxKind.EqualsEqualsEqualsToken: return '===';
    case ts.SyntaxKind.ExclamationEqualsToken: return '!=';
    case ts.SyntaxKind.ExclamationEqualsEqualsToken: return '!==';
    case ts.SyntaxKind.AmpersandAmpersandToken: return '&&';
    case ts.SyntaxKind.BarBarToken: return '||';
    case ts.SyntaxKind.QuestionQuestionToken: return '??';
    case ts.SyntaxKind.AmpersandToken: return '&';
    case ts.SyntaxKind.BarToken: return '|';
    case ts.SyntaxKind.CaretToken: return '^';
    case ts.SyntaxKind.LessThanLessThanToken: return '<<';
    case ts.SyntaxKind.GreaterThanGreaterThanToken: return '>>';
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken: return '>>>';
    case ts.SyntaxKind.EqualsToken: return '=';
    case ts.SyntaxKind.InstanceOfKeyword: return 'instanceof';
    case ts.SyntaxKind.InKeyword: return 'in';
    default:
      throw new Error(`Unknown binary operator: ${ts.SyntaxKind[kind]}`);
  }
}

function transformPrefixUnaryExpression(node: ts.PrefixUnaryExpression, checker: ts.TypeChecker | undefined): UnaryNode {
  const operand = transformExpression(node.operand, checker);
  let op: string;

  switch (node.operator) {
    case ts.SyntaxKind.MinusToken: op = '-'; break;
    case ts.SyntaxKind.PlusToken: op = '+'; break;
    case ts.SyntaxKind.ExclamationToken: op = '!'; break;
    case ts.SyntaxKind.TildeToken: op = '~'; break;
    case ts.SyntaxKind.PlusPlusToken: op = '++'; break;
    case ts.SyntaxKind.MinusMinusToken: op = '--'; break;
    default:
      throw new Error(`Unknown prefix unary operator: ${ts.SyntaxKind[node.operator]}`);
  }

  return { type: 'unary', op, operand };
}

function transformPostfixUnaryExpression(node: ts.PostfixUnaryExpression, checker: ts.TypeChecker | undefined): UnaryNode {
  const operand = transformExpression(node.operand, checker);
  let op: string;

  switch (node.operator) {
    case ts.SyntaxKind.PlusPlusToken: op = 'post++'; break;
    case ts.SyntaxKind.MinusMinusToken: op = 'post--'; break;
    default:
      throw new Error(`Unknown postfix unary operator: ${ts.SyntaxKind[node.operator]}`);
  }

  return { type: 'unary', op, operand };
}

function transformCallExpression(node: ts.CallExpression, checker: ts.TypeChecker | undefined): CallNode | MethodCallNode {
  const args = node.arguments.map(arg => transformExpression(arg, checker));

  let typeParameter: string | undefined;
  if (node.typeArguments && node.typeArguments.length > 0) {
    typeParameter = node.typeArguments[0].getText();
  }

  if (ts.isPropertyAccessExpression(node.expression)) {
    const propAccess = node.expression;
    const object = transformExpression(propAccess.expression, checker);
    const method = propAccess.name.text;

    return {
      type: 'method_call',
      object,
      method,
      args,
      typeParameter,
    };
  } else if (ts.isIdentifier(node.expression)) {
    return {
      type: 'call',
      name: node.expression.text,
      args,
    };
  } else if (ts.isCallExpression(node.expression) || ts.isParenthesizedExpression(node.expression)) {
    const callee = transformExpression(node.expression, checker);
    return {
      type: 'method_call',
      object: callee,
      method: '',
      args,
    };
  } else if (node.expression.kind === ts.SyntaxKind.SuperKeyword) {
    return {
      type: 'call',
      name: 'super',
      args,
    };
  }

  throw new Error(`Unsupported call expression: ${ts.SyntaxKind[node.expression.kind]}`);
}

function transformPropertyAccessExpression(node: ts.PropertyAccessExpression, checker: ts.TypeChecker | undefined): MemberAccessNode {
  const object = transformExpression(node.expression, checker);
  const isOptional = node.questionDotToken !== undefined;
  return {
    type: 'member_access',
    object,
    property: node.name.text,
    optional: isOptional || undefined,
  };
}

function transformElementAccessExpression(node: ts.ElementAccessExpression, checker: ts.TypeChecker | undefined): IndexAccessNode {
  const object = transformExpression(node.expression, checker);
  const index = transformExpression(node.argumentExpression, checker);
  return {
    type: 'index_access',
    object,
    index,
  };
}

function transformArrayLiteral(node: ts.ArrayLiteralExpression, checker: ts.TypeChecker | undefined): ArrayNode {
  const elements = node.elements.map(elem => transformExpression(elem, checker));
  return { type: 'array', elements };
}

function transformObjectLiteral(node: ts.ObjectLiteralExpression, checker: ts.TypeChecker | undefined): ObjectNode {
  const properties: { key: string; value: Expression }[] = [];

  for (let i = 0; i < node.properties.length; i++) {
    const prop = node.properties[i];
    if (ts.isPropertyAssignment(prop)) {
      let key: string;
      if (ts.isIdentifier(prop.name)) {
        key = prop.name.text;
      } else if (ts.isStringLiteral(prop.name)) {
        key = prop.name.text;
      } else if (ts.isComputedPropertyName(prop.name)) {
        const expr = transformExpression(prop.name.expression, checker);
        if (expr.type === 'string') {
          key = expr.value;
        } else if (expr.type === 'variable') {
          key = `[${expr.name}]`;
        } else {
          key = '[computed]';
        }
      } else {
        key = prop.name.getText();
      }

      const value = transformExpression(prop.initializer, checker);
      properties.push({ key, value });
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.text;
      const value: VariableNode = { type: 'variable', name: key };
      properties.push({ key, value });
    } else if (ts.isMethodDeclaration(prop)) {
      const key = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
      const body = prop.body ? transformBlockToBlockStatement(prop.body, checker) : { type: 'block' as const, statements: [] };
      const params = prop.parameters.map(p => ts.isIdentifier(p.name) ? p.name.text : '');
      const arrowFn: ArrowFunctionNode = {
        type: 'arrow_function',
        params,
        body,
      };
      properties.push({ key, value: arrowFn });
    }
  }

  return { type: 'object', properties };
}

function transformBlockToBlockStatement(block: ts.Block, checker: ts.TypeChecker | undefined): BlockStatement {
  const statements = block.statements.map(s => transformStatement(s, checker)).filter((s): s is Statement => s !== null);
  return { type: 'block', statements };
}

function transformNewExpression(node: ts.NewExpression, checker: ts.TypeChecker | undefined): NewNode | MapNode | SetNode {
  const args = node.arguments ? node.arguments.map(arg => transformExpression(arg, checker)) : [];

  if (ts.isIdentifier(node.expression)) {
    const className = node.expression.text;

    if (className === 'Map') {
      let keyType: string | undefined;
      let valueType: string | undefined;
      if (node.typeArguments && node.typeArguments.length >= 2) {
        keyType = extractTypeString(node.typeArguments[0]);
        valueType = extractTypeString(node.typeArguments[1]);
      }
      if (args.length > 0 && args[0].type === 'array') {
        const entries = (args[0] as ArrayNode).elements.map(elem => {
          if (elem.type === 'array' && (elem as ArrayNode).elements.length === 2) {
            return { key: (elem as ArrayNode).elements[0], value: (elem as ArrayNode).elements[1] };
          }
          return { key: elem, value: { type: 'variable' as const, name: 'undefined' } };
        });
        return { type: 'map', entries, keyType, valueType };
      }
      return { type: 'map', entries: [], keyType, valueType };
    }

    if (className === 'Set') {
      let valueType: string | undefined;
      if (node.typeArguments && node.typeArguments.length >= 1) {
        valueType = extractTypeString(node.typeArguments[0]);
      }
      if (args.length > 0 && args[0].type === 'array') {
        return { type: 'set', values: (args[0] as ArrayNode).elements, valueType };
      }
      return { type: 'set', values: [], valueType };
    }

    return { type: 'new', className, args };
  }

  throw new Error(`Unsupported new expression: ${ts.SyntaxKind[node.expression.kind]}`);
}

function transformTemplateExpression(node: ts.TemplateExpression, checker: ts.TypeChecker | undefined): TemplateLiteralNode {
  const parts: (string | Expression)[] = [];

  parts.push(node.head.text);

  for (const span of node.templateSpans) {
    parts.push(transformExpression(span.expression, checker));
    parts.push(span.literal.text);
  }

  return { type: 'template_literal', parts };
}

function transformArrowFunction(node: ts.ArrowFunction, checker: ts.TypeChecker | undefined): ArrowFunctionNode {
  const params = node.parameters.map(p => ts.isIdentifier(p.name) ? p.name.text : '');

  let body: Expression | BlockStatement;
  if (ts.isBlock(node.body)) {
    body = transformBlockToBlockStatement(node.body, checker);
  } else {
    body = transformExpression(node.body, checker);
  }

  const isAsync = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || false;

  return {
    type: 'arrow_function',
    params,
    body,
    async: isAsync || undefined,
  };
}

function transformFunctionExpression(node: ts.FunctionExpression, checker: ts.TypeChecker | undefined): ArrowFunctionNode {
  const params = node.parameters.map(p => ts.isIdentifier(p.name) ? p.name.text : '');
  const body = node.body ? transformBlockToBlockStatement(node.body, checker) : { type: 'block' as const, statements: [] };
  const isAsync = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || false;

  return {
    type: 'arrow_function',
    params,
    body,
    async: isAsync || undefined,
  };
}

function transformConditionalExpression(node: ts.ConditionalExpression, checker: ts.TypeChecker | undefined): ConditionalExpressionNode {
  return {
    type: 'conditional',
    condition: transformExpression(node.condition, checker),
    consequent: transformExpression(node.whenTrue, checker),
    alternate: transformExpression(node.whenFalse, checker),
  };
}

function transformAwaitExpression(node: ts.AwaitExpression, checker: ts.TypeChecker | undefined): AwaitExpressionNode {
  return {
    type: 'await',
    argument: transformExpression(node.expression, checker),
  };
}

function transformRegexLiteral(node: ts.RegularExpressionLiteral): RegexNode {
  const text = node.text;
  const lastSlash = text.lastIndexOf('/');
  const pattern = text.slice(1, lastSlash);
  const flags = text.slice(lastSlash + 1);
  return { type: 'regex', pattern, flags };
}

function transformTypeOfExpression(node: ts.TypeOfExpression, checker: ts.TypeChecker | undefined): UnaryNode {
  return {
    type: 'unary',
    op: 'typeof',
    operand: transformExpression(node.expression, checker),
  };
}

function transformTypeAssertion(node: ts.AsExpression | ts.TypeAssertion, checker: ts.TypeChecker | undefined): TypeAssertionNode {
  const expression = transformExpression(node.expression, checker);
  const assertedType = getTypeNodeText(node.type);
  return {
    type: 'type_assertion',
    expression,
    assertedType,
  };
}

function getTypeNodeText(typeNode: ts.TypeNode): string {
  if (ts.isTypeReferenceNode(typeNode)) {
    if (ts.isIdentifier(typeNode.typeName)) {
      return typeNode.typeName.text;
    }
    if (ts.isQualifiedName(typeNode.typeName)) {
      return typeNode.typeName.right.text;
    }
  }
  if (ts.isArrayTypeNode(typeNode)) {
    return getTypeNodeText(typeNode.elementType) + '[]';
  }
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return 'string';
  if (typeNode.kind === ts.SyntaxKind.NumberKeyword) return 'number';
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return 'boolean';
  return typeNode.getText();
}
