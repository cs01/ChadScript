import {
  WhileStatement,
  Expression,
  MethodCallNode,
  BinaryNode,
  MemberAccessNode,
  AssignmentStatement,
  VariableNode,
  NumberNode,
  IndexAccessNode,
} from "../../ast/types.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";

interface PushLoopPattern {
  sourceArrayName: string;
  destArrayName: string;
  counterName: string;
  pushArg: Expression;
  stringMethodBatch: "toUpperCase" | "toLowerCase" | null;
}

function getIdentifierName(expr: Expression): string | null {
  if (expr.type !== "variable") return null;
  return (expr as VariableNode).name;
}

function isIdentifier(expr: Expression, name: string): boolean {
  return getIdentifierName(expr) === name;
}

function isIncrementOf(assign: AssignmentStatement, varName: string): boolean {
  if (assign.name !== varName) return false;
  if (assign.value.type !== "binary") return false;
  const bin = assign.value as BinaryNode;
  if (bin.op !== "+") return false;
  const leftIsVar = isIdentifier(bin.left, varName);
  const rightIsOne =
    bin.right.type === "number" && (bin.right as NumberNode).value === 1;
  const rightIsVar = isIdentifier(bin.right, varName);
  const leftIsOne =
    bin.left.type === "number" && (bin.left as NumberNode).value === 1;
  return (leftIsVar && rightIsOne) || (rightIsVar && leftIsOne);
}

function detectStringMethodBatch(
  pushArg: Expression,
  sourceArrayName: string,
  counterName: string,
): "toUpperCase" | "toLowerCase" | null {
  if ((pushArg as { type: string }).type !== "method_call") return null;
  const call = pushArg as MethodCallNode;
  if (call.method !== "toUpperCase" && call.method !== "toLowerCase") return null;
  if (call.args.length !== 0) return null;
  if (call.object.type !== "index_access") return null;
  const idx = call.object as IndexAccessNode;
  if (getIdentifierName(idx.object) !== sourceArrayName) return null;
  if (!isIdentifier(idx.index, counterName)) return null;
  return call.method as "toUpperCase" | "toLowerCase";
}

function detectPushLoopPattern(whileStmt: WhileStatement): PushLoopPattern | null {
  const cond = whileStmt.condition;
  if (cond.type !== "binary") return null;
  const binCond = cond as BinaryNode;
  if (binCond.op !== "<") return null;

  const counterName = getIdentifierName(binCond.left);
  if (!counterName) return null;

  if (binCond.right.type !== "member_access") return null;
  const rightMember = binCond.right as MemberAccessNode;
  if (rightMember.property !== "length") return null;
  const sourceArrayName = getIdentifierName(rightMember.object);
  if (!sourceArrayName) return null;

  const stmts = whileStmt.body.statements;
  if (stmts.length !== 2) return null;

  let pushStmt = stmts[0];
  let incrStmt = stmts[1];

  if (pushStmt.type === "assignment" && (incrStmt as { type: string }).type === "method_call") {
    const tmp = pushStmt;
    pushStmt = incrStmt;
    incrStmt = tmp;
  }

  if ((pushStmt as { type: string }).type !== "method_call") return null;
  const pushCall = pushStmt as unknown as MethodCallNode;
  if (pushCall.method !== "push") return null;
  if (pushCall.args.length !== 1) return null;

  const destArrayName = getIdentifierName(pushCall.object);
  if (!destArrayName) return null;

  if ((incrStmt as { type: string }).type !== "assignment") return null;
  if (!isIncrementOf(incrStmt as unknown as AssignmentStatement, counterName)) return null;

  const stringMethodBatch = detectStringMethodBatch(pushCall.args[0], sourceArrayName, counterName);

  return {
    sourceArrayName,
    destArrayName,
    counterName,
    pushArg: pushCall.args[0],
    stringMethodBatch,
  };
}

export function tryOptimizeWhileLoopMap(
  ctx: IGeneratorContext,
  whileStmt: WhileStatement,
  params: string[],
): boolean {
  const pattern = detectPushLoopPattern(whileStmt);
  if (!pattern) return false;

  const sourceType = ctx.getVariableType(pattern.sourceArrayName);
  if (sourceType !== "%StringArray*") return false;

  const destAlloca = ctx.getVariableAlloca(pattern.destArrayName);
  if (!destAlloca) return false;
  const sourceAlloca = ctx.getVariableAlloca(pattern.sourceArrayName);
  if (!sourceAlloca) return false;

  if (pattern.stringMethodBatch) {
    const sourcePtr = ctx.emitLoad("%StringArray*", sourceAlloca);
    const funcName =
      pattern.stringMethodBatch === "toUpperCase"
        ? "@cs_str_array_to_upper"
        : "@cs_str_array_to_lower";
    const resultPtr = ctx.emitCall("%StringArray*", funcName, `%StringArray* ${sourcePtr}`);
    ctx.emitStore("%StringArray*", resultPtr, destAlloca);
    return true;
  }

  return false;
}
