import type {
  AST,
  Expression,
  Statement,
  BinaryNode,
  VariableNode,
  UnaryNode,
  VariableDeclaration,
  AssignmentStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  ReturnStatement,
  ThrowStatement,
  BlockStatement,
  ArrowFunctionNode,
  CallNode,
  MethodCallNode,
  NewNode,
  ConditionalExpressionNode,
  ArrayNode,
  TemplateLiteralNode,
  TypeAssertionNode,
  AwaitExpressionNode,
  MemberAccessNode,
  IndexAccessNode,
  ObjectNode,
  ObjectProperty,
  SpreadElementNode,
  MemberAccessAssignmentNode,
  IndexAccessAssignmentNode,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

function inferBinaryExprType(expr: Expression): string {
  if (!expr) return "unknown";
  const t = expr.type;
  if (t === "number") return "number";
  if (t === "string") return "string";
  if (t === "boolean") return "boolean";
  if (t === "null") return "null";
  if (t === "undefined") return "null";
  if (t === "array") return "array";
  if (t === "object") return "object";
  if (t === "new") return "object";
  if (t === "template_literal") return "string";
  if (t === "regex") return "object";

  if (t === "variable") {
    const v = expr as VariableNode;
    if (v.name === "NaN") return "number";
    if (v.name === "Infinity") return "number";
    return "unknown";
  }

  if (t === "unary") {
    const u = expr as UnaryNode;
    if (u.op === "!") return "boolean";
    if (u.op === "-") return "number";
    if (u.op === "+") return "number";
    if (u.op === "~") return "number";
    if (u.op === "typeof") return "string";
    return "unknown";
  }

  if (t === "binary") {
    const b = expr as BinaryNode;
    const op = b.op;
    if (op === "===" || op === "!==" || op === "<" || op === ">") return "boolean";
    if (op === "-" || op === "*" || op === "/" || op === "%") return "number";
    if (op === "+") {
      const lt = inferBinaryExprType(b.left);
      if (lt === "string") return "string";
      const rt = inferBinaryExprType(b.right);
      if (rt === "string") return "string";
      if (lt === "number" && rt === "number") return "number";
    }
    return "unknown";
  }

  return "unknown";
}

function validateBinaryOp(b: BinaryNode, sourceCode: string): void {
  const lt = inferBinaryExprType(b.left);
  const rt = inferBinaryExprType(b.right);
  if (lt === "unknown" || rt === "unknown") return;

  const op = b.op;
  if (op === "===" || op === "!==" || op === "==" || op === "!=") return;
  if (op === "&&" || op === "||" || op === "??") return;

  if (op === "+") {
    if (lt === "string" || rt === "string") return;
    if (lt === "number" && rt === "number") return;
    const output = formatCompileError(
      sourceCode,
      "cannot use '+' between '" + lt + "' and '" + rt + "'",
      b.loc,
      "use explicit conversion if intended",
      [],
    );
    process.stderr.write(output);
    process.exit(1);
    return;
  }

  if (op === "-" || op === "*" || op === "/" || op === "%") {
    if (lt === "number" && rt === "number") return;
    const output = formatCompileError(
      sourceCode,
      "cannot use '" + op + "' between '" + lt + "' and '" + rt + "'",
      b.loc,
      "arithmetic operators require both operands to be numbers",
      [],
    );
    process.stderr.write(output);
    process.exit(1);
    return;
  }
}

function checkBinaryInExpr(expr: Expression, sourceCode: string): void {
  if (!expr) return;
  const t = expr.type;
  if (t === "binary") {
    const b = expr as BinaryNode;
    checkBinaryInExpr(b.left, sourceCode);
    checkBinaryInExpr(b.right, sourceCode);
    validateBinaryOp(b, sourceCode);
  } else if (t === "call") {
    const c = expr as CallNode;
    for (let i = 0; i < c.args.length; i++) {
      checkBinaryInExpr(c.args[i], sourceCode);
    }
  } else if (t === "method_call") {
    const mc = expr as MethodCallNode;
    checkBinaryInExpr(mc.object, sourceCode);
    for (let i = 0; i < mc.args.length; i++) {
      checkBinaryInExpr(mc.args[i], sourceCode);
    }
  } else if (t === "new") {
    const n = expr as NewNode;
    for (let i = 0; i < n.args.length; i++) {
      checkBinaryInExpr(n.args[i], sourceCode);
    }
  } else if (t === "conditional") {
    const c = expr as ConditionalExpressionNode;
    checkBinaryInExpr(c.condition, sourceCode);
    checkBinaryInExpr(c.consequent, sourceCode);
    checkBinaryInExpr(c.alternate, sourceCode);
  } else if (t === "array") {
    const a = expr as ArrayNode;
    for (let i = 0; i < a.elements.length; i++) {
      checkBinaryInExpr(a.elements[i], sourceCode);
    }
  } else if (t === "template_literal") {
    const tl = expr as TemplateLiteralNode;
    for (let i = 0; i < tl.parts.length; i++) {
      const part = tl.parts[i];
      const partTyped = part as { type: string };
      if (partTyped.type) {
        checkBinaryInExpr(part as Expression, sourceCode);
      }
    }
  } else if (t === "arrow_function") {
    const arrow = expr as ArrowFunctionNode;
    const bodyTyped = arrow.body as { type: string };
    if (bodyTyped.type === "block") {
      binWalkBlock(arrow.body as BlockStatement, sourceCode);
    } else {
      checkBinaryInExpr(arrow.body as Expression, sourceCode);
    }
  } else if (t === "unary") {
    const u = expr as UnaryNode;
    checkBinaryInExpr(u.operand, sourceCode);
  } else if (t === "type_assertion") {
    const ta = expr as TypeAssertionNode;
    checkBinaryInExpr(ta.expression, sourceCode);
  } else if (t === "await") {
    const aw = expr as AwaitExpressionNode;
    checkBinaryInExpr(aw.argument, sourceCode);
  } else if (t === "member_access") {
    const ma = expr as MemberAccessNode;
    checkBinaryInExpr(ma.object, sourceCode);
  } else if (t === "index_access") {
    const ia = expr as IndexAccessNode;
    checkBinaryInExpr(ia.object, sourceCode);
    checkBinaryInExpr(ia.index, sourceCode);
  } else if (t === "object") {
    const obj = expr as ObjectNode;
    for (let i = 0; i < obj.properties.length; i++) {
      const prop = obj.properties[i] as ObjectProperty;
      checkBinaryInExpr(prop.value, sourceCode);
    }
  } else if (t === "spread_element") {
    const se = expr as SpreadElementNode;
    checkBinaryInExpr(se.argument, sourceCode);
  } else if (t === "member_access_assignment") {
    const maa = expr as MemberAccessAssignmentNode;
    checkBinaryInExpr(maa.object, sourceCode);
    checkBinaryInExpr(maa.value, sourceCode);
  } else if (t === "index_access_assignment") {
    const iaa = expr as IndexAccessAssignmentNode;
    checkBinaryInExpr(iaa.object, sourceCode);
    checkBinaryInExpr(iaa.index, sourceCode);
    checkBinaryInExpr(iaa.value, sourceCode);
  }
}

function binWalkStatement(stmt: Statement, sourceCode: string): void {
  const s = stmt as { type: string };
  const stype = s.type;

  if (stype === "variable_declaration") {
    const decl = stmt as VariableDeclaration;
    if (decl.value) {
      checkBinaryInExpr(decl.value as Expression, sourceCode);
    }
  } else if (stype === "assignment") {
    const assign = stmt as AssignmentStatement;
    checkBinaryInExpr(assign.value, sourceCode);
  } else if (stype === "if") {
    const ifStmt = stmt as IfStatement;
    checkBinaryInExpr(ifStmt.condition, sourceCode);
    binWalkBlock(ifStmt.thenBlock, sourceCode);
    if (ifStmt.elseBlock) {
      binWalkBlock(ifStmt.elseBlock, sourceCode);
    }
  } else if (stype === "while") {
    const whileStmt = stmt as WhileStatement;
    checkBinaryInExpr(whileStmt.condition, sourceCode);
    binWalkBlock(whileStmt.body, sourceCode);
  } else if (stype === "do_while") {
    const doWhileStmt = stmt as DoWhileStatement;
    binWalkBlock(doWhileStmt.body, sourceCode);
    checkBinaryInExpr(doWhileStmt.condition, sourceCode);
  } else if (stype === "for") {
    const forStmt = stmt as ForStatement;
    if (forStmt.init) {
      binWalkStatement(forStmt.init as Statement, sourceCode);
    }
    if (forStmt.condition) {
      checkBinaryInExpr(forStmt.condition, sourceCode);
    }
    if (forStmt.update) {
      const upd = forStmt.update as { type: string };
      if (upd.type === "assignment") {
        binWalkStatement(forStmt.update as Statement, sourceCode);
      } else {
        checkBinaryInExpr(forStmt.update as Expression, sourceCode);
      }
    }
    binWalkBlock(forStmt.body, sourceCode);
  } else if (stype === "for_of") {
    const forOfStmt = stmt as ForOfStatement;
    checkBinaryInExpr(forOfStmt.iterable, sourceCode);
    binWalkBlock(forOfStmt.body, sourceCode);
  } else if (stype === "try") {
    const tryStmt = stmt as TryStatement;
    binWalkBlock(tryStmt.tryBlock, sourceCode);
    if (tryStmt.catchBody) {
      binWalkBlock(tryStmt.catchBody, sourceCode);
    }
    if (tryStmt.finallyBlock) {
      binWalkBlock(tryStmt.finallyBlock, sourceCode);
    }
  } else if (stype === "switch") {
    const switchStmt = stmt as SwitchStatement;
    checkBinaryInExpr(switchStmt.discriminant, sourceCode);
    for (let ci = 0; ci < switchStmt.cases.length; ci++) {
      const c = switchStmt.cases[ci];
      if (c.test) {
        checkBinaryInExpr(c.test as Expression, sourceCode);
      }
      binWalkStatements(c.consequent, sourceCode);
    }
  } else if (stype === "return") {
    const retStmt = stmt as ReturnStatement;
    if (retStmt.value) {
      checkBinaryInExpr(retStmt.value as Expression, sourceCode);
    }
  } else if (stype === "throw") {
    const throwStmt = stmt as ThrowStatement;
    checkBinaryInExpr(throwStmt.argument, sourceCode);
  } else if (stype === "block") {
    binWalkBlock(stmt as BlockStatement, sourceCode);
  } else if (stype !== "break" && stype !== "continue") {
    checkBinaryInExpr(stmt as Expression, sourceCode);
  }
}

function binWalkStatements(stmts: Statement[], sourceCode: string): void {
  for (let i = 0; i < stmts.length; i++) {
    binWalkStatement(stmts[i], sourceCode);
  }
}

function binWalkBlock(block: BlockStatement, sourceCode: string): void {
  binWalkStatements(block.statements, sourceCode);
}

export function checkBinaryTypes(ast: AST, sourceCode: string): void {
  const items = ast.topLevelItems;
  if (items) {
    binWalkStatements(items as Statement[], sourceCode);
  }

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    binWalkBlock(fn.body, sourceCode);
  }

  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) {
      binWalkBlock(cls.methods[j].body, sourceCode);
    }
  }
}
