import {
  Expression,
  NumberNode,
  StringNode,
  BooleanNode,
  RegexNode,
  ArrayNode,
  ObjectNode,
  MapNode,
  SetNode,
  NewNode,
  UnaryNode,
  BinaryNode,
  VariableNode,
  CallNode,
  IndexAccessNode,
  MemberAccessNode,
  ConditionalExpressionNode,
  TemplateLiteralNode,
  MethodCallNode,
  IndexAccessAssignmentNode,
} from "../../ast/types.js";
import type { LiteralExpressionGenerator } from "./literals.js";
import type { VariableExpressionGenerator } from "./variables.js";
import type { BinaryExpressionGenerator } from "./operators/binary.js";
import type { UnaryExpressionGenerator } from "./operators/unary.js";
import type { CallExpressionGenerator } from "./calls.js";
import type { IndexAccessGenerator } from "./access/index.js";
import type { MemberAccessGenerator } from "./access/member.js";
import type { ConditionalExpressionGenerator } from "./conditionals.js";
import type { TemplateLiteralGenerator } from "./templates.js";
import type { MethodCallGenerator } from "./method-calls.js";

export interface ExpressionDispatchContext {
  literalGen: LiteralExpressionGenerator;
  variableGen: VariableExpressionGenerator;
  binaryGen: BinaryExpressionGenerator;
  unaryGen: UnaryExpressionGenerator;
  callGen: CallExpressionGenerator;
  indexAccessGen: IndexAccessGenerator;
  memberAccessGen: MemberAccessGenerator;
  conditionalGen: ConditionalExpressionGenerator;
  templateLiteralGen: TemplateLiteralGenerator;
  methodCallGen: MethodCallGenerator;
}

export function dispatchPrimitiveLiteral(
  ctx: ExpressionDispatchContext,
  expr: Expression,
  _params: string[],
): string | null {
  if (expr.type === "number") {
    return ctx.literalGen.generateNumber((expr as NumberNode).value);
  }
  if (expr.type === "boolean") {
    return ctx.literalGen.generateBoolean((expr as BooleanNode).value);
  }
  if (expr.type === "string") {
    return ctx.literalGen.generateString((expr as StringNode).value);
  }
  return null;
}

export function dispatchComplexLiteral(
  ctx: ExpressionDispatchContext,
  expr: Expression,
  params: string[],
): string | null {
  if (expr.type.indexOf("spread:") === 0) {
    const varName = expr.type.substr(7);
    return ctx.variableGen.generate(varName);
  }
  if (expr.type === "regex") {
    const regexExpr = expr as RegexNode;
    return ctx.literalGen.generateRegex(regexExpr.pattern, regexExpr.flags);
  }
  if (expr.type === "array") {
    return ctx.literalGen.generateArray(expr as ArrayNode, params);
  }
  if ((expr as ObjectNode).type === "object") {
    return ctx.literalGen.generateObject(expr as ObjectNode, params);
  }
  return null;
}

export function dispatchConstructorLiteral(
  ctx: ExpressionDispatchContext,
  expr: Expression,
  params: string[],
): string | null {
  if ((expr as MapNode).type === "map") {
    return ctx.literalGen.generateMap(expr as MapNode, params);
  }
  if ((expr as SetNode).type === "set") {
    return ctx.literalGen.generateSet(expr as SetNode, params);
  }
  if ((expr as NewNode).type === "new") {
    const newExpr = expr as NewNode;
    return ctx.literalGen.generateNew(newExpr.className, newExpr.args, params, newExpr.typeArgs);
  }
  if (expr.type === "this") {
    return ctx.literalGen.generateThis();
  }
  return null;
}

export function dispatchOperatorExpression(
  ctx: ExpressionDispatchContext,
  expr: Expression,
  params: string[],
): string | null {
  if (expr.type === "variable") {
    return ctx.variableGen.generate((expr as VariableNode).name);
  }
  if (expr.type === "unary") {
    const unaryExpr = expr as UnaryNode;
    return ctx.unaryGen.generate(unaryExpr.op, unaryExpr.operand, params);
  }
  if (expr.type === "binary") {
    const binExpr = expr as BinaryNode;
    return ctx.binaryGen.generate(binExpr.op, binExpr.left, binExpr.right, params);
  }
  if (expr.type === "call") {
    return ctx.callGen.generate(expr as CallNode, params);
  }
  return null;
}

export function dispatchAccessExpression(
  ctx: ExpressionDispatchContext,
  expr: Expression,
  params: string[],
): string | null {
  if (expr.type === "index_access") {
    return ctx.indexAccessGen.generate(expr as IndexAccessNode, params);
  }
  if (expr.type === "member_access") {
    return ctx.memberAccessGen.generate(expr as MemberAccessNode, params);
  }
  if (expr.type === "conditional") {
    return ctx.conditionalGen.generate(expr as ConditionalExpressionNode, params);
  }
  if (expr.type === "template_literal") {
    return ctx.templateLiteralGen.generate(expr as TemplateLiteralNode, params);
  }
  return null;
}

export function dispatchMethodAndAssignment(
  ctx: ExpressionDispatchContext,
  expr: Expression,
  params: string[],
): string | null {
  if (expr.type === "method_call") {
    return ctx.methodCallGen.generate(expr as MethodCallNode, params);
  }
  if (expr.type === "index_access_assignment") {
    return ctx.indexAccessGen.generateAssignment(expr as IndexAccessAssignmentNode, params);
  }
  return null;
}
