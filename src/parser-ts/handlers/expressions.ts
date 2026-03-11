import * as ts from "typescript";
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
  SpreadElementNode,
} from "../../ast/types.js";
import { transformStatement, extractTypeString } from "./statements.js";
import { getLoc } from "../transformer.js";

export function transformExpression(
  node: ts.Expression,
  checker: ts.TypeChecker | undefined,
): Expression {
  switch (node.kind) {
    case ts.SyntaxKind.NumericLiteral:
      return transformNumericLiteral(node as ts.NumericLiteral);

    case ts.SyntaxKind.StringLiteral:
      return transformStringLiteral(node as ts.StringLiteral);

    case ts.SyntaxKind.TrueKeyword:
      return { type: "boolean", value: true, loc: getLoc(node) };

    case ts.SyntaxKind.FalseKeyword:
      return { type: "boolean", value: false, loc: getLoc(node) };

    case ts.SyntaxKind.NullKeyword:
      return { type: "null", loc: getLoc(node) };

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
      return { type: "this", loc: getLoc(node) };

    case ts.SyntaxKind.SuperKeyword:
      return { type: "super", loc: getLoc(node) };

    case ts.SyntaxKind.TemplateExpression:
      return transformTemplateExpression(node as ts.TemplateExpression, checker);

    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return {
        type: "string",
        value: (node as ts.NoSubstitutionTemplateLiteral).text,
        loc: getLoc(node),
      };

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

    case ts.SyntaxKind.VoidExpression:
      // void <expr> evaluates the operand for side effects, then returns undefined
      transformExpression((node as ts.VoidExpression).expression, checker);
      return { type: "undefined", loc: getLoc(node) };

    // JSX desugaring — convert JSX syntax to createElement() calls
    case ts.SyntaxKind.JsxElement:
      return transformJsxElement(node as ts.JsxElement, checker);

    case ts.SyntaxKind.JsxSelfClosingElement:
      return transformJsxSelfClosingElement(node as ts.JsxSelfClosingElement, checker);

    case ts.SyntaxKind.JsxFragment:
      return transformJsxFragment(node as ts.JsxFragment, checker);

    case ts.SyntaxKind.JsxExpression:
      // Bare JSX expression container — unwrap to the inner expression
      if ((node as ts.JsxExpression).expression) {
        return transformExpression((node as ts.JsxExpression).expression!, checker);
      }
      return { type: "undefined", loc: getLoc(node) };

    default:
      throw new Error(`Unsupported expression kind: ${ts.SyntaxKind[node.kind]}`);
  }
}

export function transformExpressionStatement(
  node: ts.ExpressionStatement,
  checker: ts.TypeChecker | undefined,
): Expression {
  return transformExpression(node.expression, checker);
}

function transformNumericLiteral(node: ts.NumericLiteral): NumberNode {
  return { type: "number", value: parseFloat(node.text), loc: getLoc(node) };
}

function transformStringLiteral(node: ts.StringLiteral): StringNode {
  return { type: "string", value: node.text, loc: getLoc(node) };
}

function transformIdentifier(node: ts.Identifier): Expression {
  if (node.text === "undefined") {
    return { type: "undefined", loc: getLoc(node) };
  }
  return { type: "variable", name: node.text, loc: getLoc(node) };
}

function transformBinaryExpression(
  node: ts.BinaryExpression,
  checker: ts.TypeChecker | undefined,
): Expression {
  const left = transformExpression(node.left, checker);
  const right = transformExpression(node.right, checker);
  const op = getBinaryOperator(node.operatorToken.kind);

  if (isAssignmentOperator(node.operatorToken.kind)) {
    const compoundOp = getCompoundOperator(node.operatorToken.kind);
    if (compoundOp && node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
      const newRight: BinaryNode = { type: "binary", op: compoundOp, left, right };
      return createAssignment(node.left, newRight, checker);
    }
    return createAssignment(node.left, right, checker);
  }

  return { type: "binary", op, left, right, loc: getLoc(node) };
}

function createAssignment(
  left: ts.Expression,
  value: Expression,
  checker: ts.TypeChecker | undefined,
): Expression {
  if (ts.isIdentifier(left)) {
    return { type: "binary", op: "=", left: { type: "variable", name: left.text }, right: value };
  } else if (ts.isPropertyAccessExpression(left)) {
    const obj = transformExpression(left.expression, checker);
    return {
      type: "member_access_assignment",
      object: obj,
      property: left.name.text,
      value,
    };
  } else if (ts.isElementAccessExpression(left)) {
    const obj = transformExpression(left.expression, checker);
    const idx = transformExpression(left.argumentExpression, checker);
    return {
      type: "index_access_assignment",
      object: obj,
      index: idx,
      value,
    };
  }
  throw new Error(`Cannot create assignment for ${ts.SyntaxKind[left.kind]}`);
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.BarEqualsToken ||
    kind === ts.SyntaxKind.AmpersandEqualsToken
  );
}

function getCompoundOperator(kind: ts.SyntaxKind): string | null {
  switch (kind) {
    case ts.SyntaxKind.PlusEqualsToken:
      return "+";
    case ts.SyntaxKind.MinusEqualsToken:
      return "-";
    case ts.SyntaxKind.AsteriskEqualsToken:
      return "*";
    case ts.SyntaxKind.SlashEqualsToken:
      return "/";
    case ts.SyntaxKind.BarEqualsToken:
      return "|";
    case ts.SyntaxKind.AmpersandEqualsToken:
      return "&";
    default:
      return null;
  }
}

function getBinaryOperator(kind: ts.SyntaxKind): string {
  switch (kind) {
    case ts.SyntaxKind.PlusToken:
      return "+";
    case ts.SyntaxKind.MinusToken:
      return "-";
    case ts.SyntaxKind.AsteriskToken:
      return "*";
    case ts.SyntaxKind.SlashToken:
      return "/";
    case ts.SyntaxKind.PercentToken:
      return "%";
    case ts.SyntaxKind.AsteriskAsteriskToken:
      return "**";
    case ts.SyntaxKind.LessThanToken:
      return "<";
    case ts.SyntaxKind.GreaterThanToken:
      return ">";
    case ts.SyntaxKind.LessThanEqualsToken:
      return "<=";
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return ">=";
    case ts.SyntaxKind.EqualsEqualsToken:
      return "==";
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return "===";
    case ts.SyntaxKind.ExclamationEqualsToken:
      return "!=";
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return "!==";
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return "&&";
    case ts.SyntaxKind.BarBarToken:
      return "||";
    case ts.SyntaxKind.QuestionQuestionToken:
      return "??";
    case ts.SyntaxKind.AmpersandToken:
      return "&";
    case ts.SyntaxKind.BarToken:
      return "|";
    case ts.SyntaxKind.CaretToken:
      return "^";
    case ts.SyntaxKind.LessThanLessThanToken:
      return "<<";
    case ts.SyntaxKind.GreaterThanGreaterThanToken:
      return ">>";
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
      return ">>>";
    case ts.SyntaxKind.EqualsToken:
      return "=";
    case ts.SyntaxKind.InstanceOfKeyword:
      return "instanceof";
    case ts.SyntaxKind.InKeyword:
      return "in";
    default:
      throw new Error(`Unknown binary operator: ${ts.SyntaxKind[kind]}`);
  }
}

function transformPrefixUnaryExpression(
  node: ts.PrefixUnaryExpression,
  checker: ts.TypeChecker | undefined,
): UnaryNode {
  const operand = transformExpression(node.operand, checker);
  let op: string;

  switch (node.operator) {
    case ts.SyntaxKind.MinusToken:
      op = "-";
      break;
    case ts.SyntaxKind.PlusToken:
      op = "+";
      break;
    case ts.SyntaxKind.ExclamationToken:
      op = "!";
      break;
    case ts.SyntaxKind.TildeToken:
      op = "~";
      break;
    case ts.SyntaxKind.PlusPlusToken:
      op = "++";
      break;
    case ts.SyntaxKind.MinusMinusToken:
      op = "--";
      break;
    default:
      throw new Error(`Unknown prefix unary operator: ${ts.SyntaxKind[node.operator]}`);
  }

  return { type: "unary", op, operand, loc: getLoc(node) };
}

function transformPostfixUnaryExpression(
  node: ts.PostfixUnaryExpression,
  checker: ts.TypeChecker | undefined,
): UnaryNode {
  const operand = transformExpression(node.operand, checker);
  let op: string;

  switch (node.operator) {
    case ts.SyntaxKind.PlusPlusToken:
      op = "post++";
      break;
    case ts.SyntaxKind.MinusMinusToken:
      op = "post--";
      break;
    default:
      throw new Error(`Unknown postfix unary operator: ${ts.SyntaxKind[node.operator]}`);
  }

  return { type: "unary", op, operand, loc: getLoc(node) };
}

function transformCallExpression(
  node: ts.CallExpression,
  checker: ts.TypeChecker | undefined,
): CallNode | MethodCallNode {
  const args = node.arguments.map((arg) => {
    if (ts.isSpreadElement(arg)) {
      return transformExpression(arg.expression, checker);
    }
    return transformExpression(arg, checker);
  });

  let typeParameter: string | undefined;
  if (node.typeArguments && node.typeArguments.length > 0) {
    typeParameter = node.typeArguments[0].getText();
  }

  if (ts.isPropertyAccessExpression(node.expression)) {
    const propAccess = node.expression;
    const object = transformExpression(propAccess.expression, checker);
    const method = propAccess.name.text;
    // Propagate ?. from the property access to the method call
    const isOptional = propAccess.questionDotToken !== undefined;

    // Field order must match MethodCallNode interface — optional goes last
    // to avoid shifting GEP indices for existing creation sites
    return {
      type: "method_call",
      object,
      method,
      args,
      typeParameter,
      pos: node.getStart(),
      loc: getLoc(node),
      optional: isOptional || undefined,
    } as MethodCallNode;
  } else if (ts.isIdentifier(node.expression)) {
    const callTypeArgs =
      node.typeArguments && node.typeArguments.length > 0
        ? node.typeArguments.map((ta) => ta.getText())
        : undefined;
    return {
      type: "call",
      name: node.expression.text,
      args,
      loc: getLoc(node),
      typeArgs: callTypeArgs,
    };
  } else if (
    ts.isCallExpression(node.expression) ||
    ts.isParenthesizedExpression(node.expression)
  ) {
    const callee = transformExpression(node.expression, checker);
    return {
      type: "method_call",
      object: callee,
      method: "",
      args,
      pos: node.getStart(),
      loc: getLoc(node),
    };
  } else if (node.expression.kind === ts.SyntaxKind.SuperKeyword) {
    return {
      type: "call",
      name: "super",
      args,
      loc: getLoc(node),
    };
  }

  throw new Error(`Unsupported call expression: ${ts.SyntaxKind[node.expression.kind]}`);
}

function transformPropertyAccessExpression(
  node: ts.PropertyAccessExpression,
  checker: ts.TypeChecker | undefined,
): MemberAccessNode {
  const object = transformExpression(node.expression, checker);
  const isOptional = node.questionDotToken !== undefined;
  return {
    type: "member_access",
    object,
    property: node.name.text,
    optional: isOptional || undefined,
    loc: getLoc(node),
  };
}

function transformElementAccessExpression(
  node: ts.ElementAccessExpression,
  checker: ts.TypeChecker | undefined,
): IndexAccessNode {
  const object = transformExpression(node.expression, checker);
  const index = transformExpression(node.argumentExpression, checker);
  return {
    type: "index_access",
    object,
    index,
    loc: getLoc(node),
  };
}

function transformArrayLiteral(
  node: ts.ArrayLiteralExpression,
  checker: ts.TypeChecker | undefined,
): ArrayNode {
  const elements = node.elements.map((elem) => {
    if (ts.isSpreadElement(elem)) {
      const argument = transformExpression(elem.expression, checker);
      return { type: "spread_element", argument } as SpreadElementNode;
    }
    return transformExpression(elem, checker);
  });
  return { type: "array", elements, loc: getLoc(node) };
}

function transformObjectLiteral(
  node: ts.ObjectLiteralExpression,
  checker: ts.TypeChecker | undefined,
): ObjectNode {
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
        if (expr.type === "string") {
          key = expr.value;
        } else if (expr.type === "variable") {
          key = `[${expr.name}]`;
        } else {
          key = "[computed]";
        }
      } else {
        key = prop.name.getText();
      }

      const value = transformExpression(prop.initializer, checker);
      properties.push({ key, value });
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.text;
      const value: VariableNode = { type: "variable", name: key };
      properties.push({ key, value });
    } else if (ts.isSpreadAssignment(prop)) {
      throw new Error("Object spread (...) is not yet supported in ChadScript");
    } else if (ts.isMethodDeclaration(prop)) {
      const key = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
      const body = prop.body
        ? transformBlockToBlockStatement(prop.body, checker)
        : { type: "block" as const, statements: [] };
      const params = prop.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));
      const arrowFn: ArrowFunctionNode = {
        type: "arrow_function",
        params,
        body,
      };
      properties.push({ key, value: arrowFn });
    }
  }

  return { type: "object", properties, loc: getLoc(node) };
}

function transformBlockToBlockStatement(
  block: ts.Block,
  checker: ts.TypeChecker | undefined,
): BlockStatement {
  const statements = block.statements
    .map((s) => transformStatement(s, checker))
    .filter((s): s is Statement => s !== null);
  return { type: "block", statements };
}

function transformNewExpression(
  node: ts.NewExpression,
  checker: ts.TypeChecker | undefined,
): NewNode | MapNode | SetNode {
  const args = node.arguments ? node.arguments.map((arg) => transformExpression(arg, checker)) : [];

  if (ts.isIdentifier(node.expression)) {
    const className = node.expression.text;

    if (className === "Map") {
      let keyType: string | undefined;
      let valueType: string | undefined;
      if (node.typeArguments && node.typeArguments.length >= 2) {
        keyType = extractTypeString(node.typeArguments[0]);
        valueType = extractTypeString(node.typeArguments[1]);
      }
      if (args.length > 0 && args[0].type === "array") {
        const entries = (args[0] as ArrayNode).elements.map((elem) => {
          if (elem.type === "array" && (elem as ArrayNode).elements.length === 2) {
            return { key: (elem as ArrayNode).elements[0], value: (elem as ArrayNode).elements[1] };
          }
          return { key: elem, value: { type: "variable" as const, name: "undefined" } };
        });
        return { type: "map", entries, keyType, valueType, loc: getLoc(node) };
      }
      return { type: "map", entries: [], keyType, valueType, loc: getLoc(node) };
    }

    if (className === "Set") {
      let valueType: string | undefined;
      if (node.typeArguments && node.typeArguments.length >= 1) {
        valueType = extractTypeString(node.typeArguments[0]);
      }
      if (args.length > 0 && args[0].type === "array") {
        return {
          type: "set",
          values: (args[0] as ArrayNode).elements,
          valueType,
          loc: getLoc(node),
        };
      }
      return { type: "set", values: [], valueType, loc: getLoc(node) };
    }

    return { type: "new", className, args, loc: getLoc(node) };
  }

  throw new Error(`Unsupported new expression: ${ts.SyntaxKind[node.expression.kind]}`);
}

function transformTemplateExpression(
  node: ts.TemplateExpression,
  checker: ts.TypeChecker | undefined,
): TemplateLiteralNode {
  const parts: (string | Expression)[] = [];

  parts.push({ type: "string", value: node.head.text } as Expression);

  for (const span of node.templateSpans) {
    parts.push(transformExpression(span.expression, checker));
    parts.push({ type: "string", value: span.literal.text } as Expression);
  }

  return { type: "template_literal", parts, loc: getLoc(node) };
}

function transformArrowFunction(
  node: ts.ArrowFunction,
  checker: ts.TypeChecker | undefined,
): ArrowFunctionNode {
  const params = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));

  let body: Expression | BlockStatement;
  if (ts.isBlock(node.body)) {
    body = transformBlockToBlockStatement(node.body, checker);
  } else {
    body = transformExpression(node.body, checker);
  }

  const isAsync = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false;

  return {
    type: "arrow_function",
    params,
    body,
    async: isAsync || undefined,
    loc: getLoc(node),
  };
}

function transformFunctionExpression(
  node: ts.FunctionExpression,
  checker: ts.TypeChecker | undefined,
): ArrowFunctionNode {
  const params = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));
  const body = node.body
    ? transformBlockToBlockStatement(node.body, checker)
    : { type: "block" as const, statements: [] };
  const isAsync = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false;

  return {
    type: "arrow_function",
    params,
    body,
    async: isAsync || undefined,
    loc: getLoc(node),
  };
}

function transformConditionalExpression(
  node: ts.ConditionalExpression,
  checker: ts.TypeChecker | undefined,
): ConditionalExpressionNode {
  return {
    type: "conditional",
    condition: transformExpression(node.condition, checker),
    consequent: transformExpression(node.whenTrue, checker),
    alternate: transformExpression(node.whenFalse, checker),
    loc: getLoc(node),
  };
}

function transformAwaitExpression(
  node: ts.AwaitExpression,
  checker: ts.TypeChecker | undefined,
): AwaitExpressionNode {
  return {
    type: "await",
    argument: transformExpression(node.expression, checker),
    loc: getLoc(node),
  };
}

function transformRegexLiteral(node: ts.RegularExpressionLiteral): RegexNode {
  const text = node.text;
  const lastSlash = text.lastIndexOf("/");
  const pattern = text.slice(1, lastSlash);
  const flags = text.slice(lastSlash + 1);
  return { type: "regex", pattern, flags, loc: getLoc(node) };
}

function transformTypeOfExpression(
  node: ts.TypeOfExpression,
  checker: ts.TypeChecker | undefined,
): UnaryNode {
  return {
    type: "unary",
    op: "typeof",
    operand: transformExpression(node.expression, checker),
    loc: getLoc(node),
  };
}

function transformTypeAssertion(
  node: ts.AsExpression | ts.TypeAssertion,
  checker: ts.TypeChecker | undefined,
): TypeAssertionNode {
  const expression = transformExpression(node.expression, checker);
  const assertedType = getTypeNodeText(node.type);
  return {
    type: "type_assertion",
    expression,
    assertedType,
    loc: getLoc(node),
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
    return getTypeNodeText(typeNode.elementType) + "[]";
  }
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return "string";
  if (typeNode.kind === ts.SyntaxKind.NumberKeyword) return "number";
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return "boolean";
  return typeNode.getText();
}

// ============================================
// JSX DESUGARING
// Converts JSX syntax to createElement() calls.
// <Tag prop={v}>child</Tag>  →  createElement("Tag", { prop: v }, [child])
// ============================================

function getJsxTagName(tagName: ts.JsxTagNameExpression): string {
  if (ts.isIdentifier(tagName)) {
    return tagName.text;
  }
  if (ts.isPropertyAccessExpression(tagName)) {
    return tagName.getText();
  }
  return tagName.getText();
}

function transformJsxElement(node: ts.JsxElement, checker: ts.TypeChecker | undefined): CallNode {
  const tagName = getJsxTagName(node.openingElement.tagName);
  const props = transformJsxAttributes(node.openingElement.attributes, checker);
  const children = transformJsxChildren(node.children, checker);

  return {
    type: "call",
    name: "createElement",
    args: [{ type: "string", value: tagName } as StringNode, props, children],
    loc: getLoc(node),
  };
}

function transformJsxSelfClosingElement(
  node: ts.JsxSelfClosingElement,
  checker: ts.TypeChecker | undefined,
): CallNode {
  const tagName = getJsxTagName(node.tagName);
  const props = transformJsxAttributes(node.attributes, checker);

  return {
    type: "call",
    name: "createElement",
    args: [
      { type: "string", value: tagName } as StringNode,
      props,
      { type: "array", elements: [] } as ArrayNode,
    ],
    loc: getLoc(node),
  };
}

function transformJsxFragment(node: ts.JsxFragment, checker: ts.TypeChecker | undefined): CallNode {
  const children = transformJsxChildren(node.children, checker);

  return {
    type: "call",
    name: "createElement",
    args: [
      { type: "string", value: "Fragment" } as StringNode,
      { type: "object", properties: [] } as ObjectNode,
      children,
    ],
    loc: getLoc(node),
  };
}

function transformJsxAttributes(
  attributes: ts.JsxAttributes,
  checker: ts.TypeChecker | undefined,
): ObjectNode {
  const properties: { key: string; value: Expression }[] = [];

  for (const attr of attributes.properties) {
    if (ts.isJsxAttribute(attr)) {
      // attr.name is Identifier or JsxNamespacedName — use getText() for both
      const key = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText();
      let value: Expression;

      if (!attr.initializer) {
        // Boolean shorthand: <Input disabled /> → { disabled: true }
        value = { type: "boolean", value: true };
      } else if (ts.isStringLiteral(attr.initializer)) {
        value = { type: "string", value: attr.initializer.text };
      } else if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
        value = transformExpression(attr.initializer.expression, checker);
      } else {
        value = { type: "undefined" };
      }

      properties.push({ key, value });
    }
    // ts.isJsxSpreadAttribute — spread attributes out of scope for v1
  }

  return { type: "object", properties };
}

function transformJsxChildren(
  children: ts.NodeArray<ts.JsxChild>,
  checker: ts.TypeChecker | undefined,
): ArrayNode {
  const elements: Expression[] = [];

  for (const child of children) {
    if (ts.isJsxText(child)) {
      // Trim whitespace-only text nodes (indentation, newlines between tags)
      const trimmed = child.text.trim();
      if (trimmed.length === 0) continue;
      elements.push({ type: "string", value: trimmed });
    } else if (ts.isJsxExpression(child)) {
      if (child.expression) {
        elements.push(transformExpression(child.expression, checker));
      }
    } else if (ts.isJsxElement(child)) {
      elements.push(transformJsxElement(child, checker));
    } else if (ts.isJsxSelfClosingElement(child)) {
      elements.push(transformJsxSelfClosingElement(child, checker));
    } else if (ts.isJsxFragment(child)) {
      elements.push(transformJsxFragment(child, checker));
    }
  }

  return { type: "array", elements };
}
