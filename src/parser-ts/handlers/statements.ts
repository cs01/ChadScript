import * as ts from "typescript";
import {
  Statement,
  Expression,
  BlockStatement,
  VariableDeclaration,
  AssignmentStatement,
  ReturnStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  ThrowStatement,
  TryStatement,
  IndexAccessNode,
  MemberAccessNode,
  VariableNode,
} from "../../ast/types.js";
import { transformExpression } from "./expressions.js";
import { getLoc } from "../transformer.js";

function reportVarError(node: ts.Node): never {
  const loc = getLoc(node);
  console.error(
    loc.file +
      ":" +
      loc.line +
      ":" +
      (loc.column + 1) +
      ": error: 'var' is not allowed; use 'let' or 'const'",
  );
  process.exit(1);
}

export function transformStatement(
  node: ts.Statement,
  checker: ts.TypeChecker | undefined,
): Statement | null {
  switch (node.kind) {
    case ts.SyntaxKind.VariableStatement:
      return transformVariableStatement(node as ts.VariableStatement, checker);

    case ts.SyntaxKind.ExpressionStatement:
      return transformExpressionStatement(node as ts.ExpressionStatement, checker);

    case ts.SyntaxKind.ReturnStatement:
      return transformReturnStatement(node as ts.ReturnStatement, checker);

    case ts.SyntaxKind.IfStatement:
      return transformIfStatement(node as ts.IfStatement, checker);

    case ts.SyntaxKind.WhileStatement:
      return transformWhileStatement(node as ts.WhileStatement, checker);

    case ts.SyntaxKind.DoStatement:
      return transformDoWhileStatement(node as ts.DoStatement, checker);

    case ts.SyntaxKind.ForStatement:
      return transformForStatement(node as ts.ForStatement, checker);

    case ts.SyntaxKind.ForOfStatement:
      return transformForOfStatement(node as ts.ForOfStatement, checker);

    case ts.SyntaxKind.ForInStatement:
      return transformForInStatement(node as ts.ForInStatement, checker);

    case ts.SyntaxKind.BreakStatement:
      return { type: "break", loc: getLoc(node) };

    case ts.SyntaxKind.ContinueStatement:
      return { type: "continue", loc: getLoc(node) };

    case ts.SyntaxKind.ThrowStatement:
      return transformThrowStatement(node as ts.ThrowStatement, checker);

    case ts.SyntaxKind.TryStatement:
      return transformTryStatement(node as ts.TryStatement, checker);

    case ts.SyntaxKind.Block:
      return null;

    case ts.SyntaxKind.EmptyStatement:
      return null;

    case ts.SyntaxKind.SwitchStatement:
      return transformSwitchToIfElse(node as ts.SwitchStatement, checker);

    case ts.SyntaxKind.LabeledStatement: {
      const loc = getLoc(node);
      console.error(
        loc.file +
          ":" +
          loc.line +
          ":" +
          loc.column +
          ": error: labeled statements (e.g., 'outer: for') are not supported; use a flag variable with regular break instead",
      );
      process.exit(1);
      break;
    }

    default:
      return null;
  }
}

function transformVariableStatement(
  node: ts.VariableStatement,
  checker: ts.TypeChecker | undefined,
): Statement {
  const flags = node.declarationList.flags;
  if (!(flags & ts.NodeFlags.Const) && !(flags & ts.NodeFlags.Let)) {
    reportVarError(node);
  }
  const declarations = node.declarationList.declarations;
  if (declarations.length === 1) {
    return transformVariableDecl(declarations[0], node.declarationList.flags, checker);
  }

  const first = transformVariableDecl(declarations[0], node.declarationList.flags, checker);
  return first;
}

let destructureCounter = 0;

function desugarObjectDestructuring(
  decl: ts.VariableDeclaration,
  pattern: ts.ObjectBindingPattern,
  flags: ts.NodeFlags,
  checker: ts.TypeChecker | undefined,
): BlockStatement {
  const kind: "let" | "const" = flags & ts.NodeFlags.Const ? "const" : "let";
  const statements: Statement[] = [];

  let source: Expression | null = null;
  if (decl.initializer) {
    source = transformExpression(decl.initializer, checker);
  }

  let objectRef: Expression = source!;
  if (source && source.type !== "variable") {
    const tempName = `__destructure_${destructureCounter++}`;
    let declaredType: string | undefined;
    if (decl.initializer && checker) {
      const initType = checker.getTypeAtLocation(decl.initializer);
      const typeStr = checker.typeToString(initType);
      if (typeStr && typeStr !== "any" && typeStr !== "unknown") {
        declaredType = typeStr;
      }
    }
    statements.push({
      type: "variable_declaration",
      kind: "const",
      name: tempName,
      value: source,
      declaredType,
      loc: undefined,
    } as VariableDeclaration);
    objectRef = { type: "variable", name: tempName } as VariableNode;
  }

  for (const element of pattern.elements) {
    if (!ts.isBindingElement(element)) continue;
    if (!ts.isIdentifier(element.name)) continue;

    const localName = element.name.text;
    const propertyName =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : localName;

    const memberAccess: MemberAccessNode = {
      type: "member_access",
      object: objectRef,
      property: propertyName,
    };

    statements.push({
      type: "variable_declaration",
      kind,
      name: localName,
      value: memberAccess,
      declaredType: undefined,
      loc: undefined,
    });
  }

  return { type: "block", statements };
}

function desugarArrayDestructuring(
  decl: ts.VariableDeclaration,
  pattern: ts.ArrayBindingPattern,
  flags: ts.NodeFlags,
  checker: ts.TypeChecker | undefined,
): BlockStatement {
  const kind: "let" | "const" = flags & ts.NodeFlags.Const ? "const" : "let";
  const statements: Statement[] = [];

  let source: Expression | null = null;
  if (decl.initializer) {
    source = transformExpression(decl.initializer, checker);
  }

  let arrayRef: Expression = source!;
  if (source && source.type !== "variable") {
    const tempName = `__destructure_${destructureCounter++}`;
    let declaredType: string | undefined;
    if (decl.initializer && checker) {
      const initType = checker.getTypeAtLocation(decl.initializer);
      const typeStr = checker.typeToString(initType);
      if (typeStr && typeStr !== "any" && typeStr !== "unknown") {
        declaredType = typeStr;
      }
    }
    statements.push({
      type: "variable_declaration",
      kind: "const",
      name: tempName,
      value: source,
      declaredType,
      loc: undefined,
    } as VariableDeclaration);
    arrayRef = { type: "variable", name: tempName } as VariableNode;
  }

  for (let i = 0; i < pattern.elements.length; i++) {
    const element = pattern.elements[i];
    if (ts.isOmittedExpression(element)) continue;
    if (!ts.isBindingElement(element)) continue;
    if (!ts.isIdentifier(element.name)) continue;

    const localName = element.name.text;

    const indexAccess: IndexAccessNode = {
      type: "index_access",
      object: arrayRef,
      index: { type: "number", value: i },
    };

    statements.push({
      type: "variable_declaration",
      kind,
      name: localName,
      value: indexAccess,
      declaredType: undefined,
      loc: undefined,
    });
  }

  return { type: "block", statements };
}

function transformVariableDecl(
  decl: ts.VariableDeclaration,
  flags: ts.NodeFlags,
  checker: ts.TypeChecker | undefined,
): VariableDeclaration | BlockStatement {
  if (ts.isObjectBindingPattern(decl.name)) {
    return desugarObjectDestructuring(decl, decl.name, flags, checker);
  }
  if (ts.isArrayBindingPattern(decl.name)) {
    return desugarArrayDestructuring(decl, decl.name, flags, checker);
  }

  const name = ts.isIdentifier(decl.name) ? decl.name.text : "";
  const kind: "let" | "const" = flags & ts.NodeFlags.Const ? "const" : "let";

  let declaredType: string | undefined;
  if (decl.type) {
    declaredType = extractTypeString(decl.type);
  }

  let value: Expression | null = null;
  if (decl.initializer) {
    value = transformExpression(decl.initializer, checker);
  }

  return { type: "variable_declaration", kind, name, value, declaredType, loc: getLoc(decl) };
}

export function extractTypeString(typeNode: ts.TypeNode): string {
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = ts.isIdentifier(typeNode.typeName)
      ? typeNode.typeName.text
      : typeNode.typeName.getText();

    if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      const args = typeNode.typeArguments.map(extractTypeString).join(", ");
      return `${typeName}<${args}>`;
    }
    return typeName;
  } else if (ts.isArrayTypeNode(typeNode)) {
    const elem = extractTypeString(typeNode.elementType);
    return `${elem}[]`;
  } else if (typeNode.kind === ts.SyntaxKind.StringKeyword) {
    return "string";
  } else if (typeNode.kind === ts.SyntaxKind.NumberKeyword) {
    return "number";
  } else if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) {
    return "boolean";
  } else if (typeNode.kind === ts.SyntaxKind.VoidKeyword) {
    return "void";
  } else if (typeNode.kind === ts.SyntaxKind.AnyKeyword) {
    return "any";
  } else if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.map(extractTypeString).join(" | ");
  } else if (ts.isTypeLiteralNode(typeNode)) {
    const members: string[] = [];
    for (const member of typeNode.members) {
      if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
        const propName = member.name.text;
        const propType = member.type ? extractTypeString(member.type) : "any";
        members.push(`${propName}: ${propType}`);
      }
    }
    if (members.length > 0) {
      return `{ ${members.join("; ")} }`;
    }
    return "object";
  }
  return typeNode.getText();
}

function transformExpressionStatement(
  node: ts.ExpressionStatement,
  checker: ts.TypeChecker | undefined,
): Statement {
  const expr = node.expression;

  if (ts.isBinaryExpression(expr) && isAssignmentOperator(expr.operatorToken.kind)) {
    return transformAssignmentExpr(expr, checker);
  }

  return transformExpression(expr, checker);
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken ||
    kind === ts.SyntaxKind.BarEqualsToken ||
    kind === ts.SyntaxKind.AmpersandEqualsToken ||
    kind === ts.SyntaxKind.CaretEqualsToken ||
    kind === ts.SyntaxKind.LessThanLessThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken
  );
}

function transformAssignmentExpr(
  node: ts.BinaryExpression,
  checker: ts.TypeChecker | undefined,
): AssignmentStatement {
  const left = node.left;
  const right = transformExpression(node.right, checker);

  let value: Expression = right;
  const op = node.operatorToken.kind;
  if (op !== ts.SyntaxKind.EqualsToken) {
    const leftExpr = transformExpression(left, checker);
    const opStr = getCompoundOperator(op);
    if (opStr) {
      value = { type: "binary", op: opStr, left: leftExpr, right };
    }
  }

  if (ts.isIdentifier(left)) {
    return { type: "assignment", name: left.text, value };
  } else if (ts.isPropertyAccessExpression(left)) {
    const obj = transformExpression(left.expression, checker);
    return {
      type: "assignment",
      name: `__member_access__${left.name.text}__`,
      value: {
        type: "member_access_assignment",
        object: obj,
        property: left.name.text,
        value,
      },
    };
  } else if (ts.isElementAccessExpression(left)) {
    const obj = transformExpression(left.expression, checker);
    const idx = transformExpression(left.argumentExpression, checker);
    return {
      type: "assignment",
      name: "__index_access__",
      value: {
        type: "index_access_assignment",
        object: obj,
        index: idx,
        value,
      },
    };
  }

  throw new Error(`Cannot assign to ${ts.SyntaxKind[left.kind]}`);
}

function getCompoundOperator(op: ts.SyntaxKind): string | null {
  switch (op) {
    case ts.SyntaxKind.PlusEqualsToken:
      return "+";
    case ts.SyntaxKind.MinusEqualsToken:
      return "-";
    case ts.SyntaxKind.AsteriskEqualsToken:
      return "*";
    case ts.SyntaxKind.SlashEqualsToken:
      return "/";
    case ts.SyntaxKind.PercentEqualsToken:
      return "%";
    case ts.SyntaxKind.BarEqualsToken:
      return "|";
    case ts.SyntaxKind.AmpersandEqualsToken:
      return "&";
    case ts.SyntaxKind.CaretEqualsToken:
      return "^";
    case ts.SyntaxKind.LessThanLessThanEqualsToken:
      return "<<";
    case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
      return ">>";
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
      return ">>>";
    case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
      return "**";
    default:
      return null;
  }
}

function transformReturnStatement(
  node: ts.ReturnStatement,
  checker: ts.TypeChecker | undefined,
): ReturnStatement {
  const value = node.expression
    ? transformExpression(node.expression, checker)
    : { type: "variable" as const, name: "undefined" };
  return { type: "return", value, loc: getLoc(node) };
}

function transformIfStatement(
  node: ts.IfStatement,
  checker: ts.TypeChecker | undefined,
): IfStatement {
  const condition = transformExpression(node.expression, checker);
  const thenBlock = wrapInBlock(node.thenStatement, checker);

  let elseBlock: BlockStatement | null = null;
  if (node.elseStatement) {
    if (ts.isIfStatement(node.elseStatement)) {
      const nestedIf = transformIfStatement(node.elseStatement, checker);
      elseBlock = { type: "block", statements: [nestedIf] };
    } else {
      elseBlock = wrapInBlock(node.elseStatement, checker);
    }
  }

  return { type: "if", condition, thenBlock, elseBlock, loc: getLoc(node) };
}

function transformWhileStatement(
  node: ts.WhileStatement,
  checker: ts.TypeChecker | undefined,
): WhileStatement {
  const condition = transformExpression(node.expression, checker);
  const body = wrapInBlock(node.statement, checker);
  return { type: "while", condition, body, loc: getLoc(node) };
}

function transformDoWhileStatement(
  node: ts.DoStatement,
  checker: ts.TypeChecker | undefined,
): DoWhileStatement {
  const condition = transformExpression(node.expression, checker);
  const body = wrapInBlock(node.statement, checker);
  return { type: "do_while", condition, body, loc: getLoc(node) };
}

function transformForStatement(
  node: ts.ForStatement,
  checker: ts.TypeChecker | undefined,
): ForStatement {
  let init: VariableDeclaration | AssignmentStatement | null = null;

  if (node.initializer) {
    if (ts.isVariableDeclarationList(node.initializer)) {
      const initFlags = node.initializer.flags;
      if (!(initFlags & ts.NodeFlags.Const) && !(initFlags & ts.NodeFlags.Let)) {
        reportVarError(node);
      }
      const decl = node.initializer.declarations[0];
      init = transformVariableDecl(decl, node.initializer.flags, checker) as VariableDeclaration;
    } else {
      const expr = node.initializer;
      if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (ts.isIdentifier(expr.left)) {
          init = {
            type: "assignment",
            name: expr.left.text,
            value: transformExpression(expr.right, checker),
          };
        }
      }
    }
  }

  let condition: Expression | null = null;
  if (node.condition) {
    condition = transformExpression(node.condition, checker);
  }

  let update: AssignmentStatement | Expression | null = null;
  if (node.incrementor) {
    if (
      ts.isBinaryExpression(node.incrementor) &&
      isAssignmentOperator(node.incrementor.operatorToken.kind)
    ) {
      update = transformAssignmentExpr(node.incrementor, checker);
    } else {
      update = transformExpression(node.incrementor, checker);
    }
  }

  const body = wrapInBlock(node.statement, checker);

  return { type: "for", init, condition, update, body, loc: getLoc(node) };
}

function transformForOfStatement(
  node: ts.ForOfStatement,
  checker: ts.TypeChecker | undefined,
): ForOfStatement {
  let variableName = "";
  let variableKind: "let" | "const" | "var" = "const";
  let destructuredNames: string[] | undefined;

  if (ts.isVariableDeclarationList(node.initializer)) {
    const ofFlags = node.initializer.flags;
    if (!(ofFlags & ts.NodeFlags.Const) && !(ofFlags & ts.NodeFlags.Let)) {
      reportVarError(node);
    }
    const decl = node.initializer.declarations[0];
    if (ts.isIdentifier(decl.name)) {
      variableName = decl.name.text;
    } else if (ts.isArrayBindingPattern(decl.name)) {
      destructuredNames = [];
      for (const element of decl.name.elements) {
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
          destructuredNames.push(element.name.text);
        }
      }
      variableName = destructuredNames[0] || "";
    }
    variableKind = node.initializer.flags & ts.NodeFlags.Const ? "const" : "let";
  }

  const iterable = transformExpression(node.expression, checker);
  const body = wrapInBlock(node.statement, checker);

  return {
    type: "for_of",
    variableKind,
    variableName,
    destructuredNames,
    iterable,
    body,
    loc: getLoc(node),
  };
}

function transformForInStatement(
  node: ts.ForInStatement,
  checker: ts.TypeChecker | undefined,
): ForOfStatement {
  let variableName = "";
  let variableKind: "let" | "const" | "var" = "const";

  if (ts.isVariableDeclarationList(node.initializer)) {
    const inFlags = node.initializer.flags;
    if (!(inFlags & ts.NodeFlags.Const) && !(inFlags & ts.NodeFlags.Let)) {
      reportVarError(node);
    }
    const decl = node.initializer.declarations[0];
    if (ts.isIdentifier(decl.name)) {
      variableName = decl.name.text;
    }
    variableKind = node.initializer.flags & ts.NodeFlags.Const ? "const" : "let";
  }

  const obj = transformExpression(node.expression, checker);
  const keysCall: Expression = {
    type: "method_call",
    object: { type: "variable", name: "Object" },
    method: "keys",
    args: [obj],
  };

  const body = wrapInBlock(node.statement, checker);

  return {
    type: "for_of",
    variableKind,
    variableName,
    iterable: keysCall,
    body,
    loc: getLoc(node),
  };
}

function transformThrowStatement(
  node: ts.ThrowStatement,
  checker: ts.TypeChecker | undefined,
): ThrowStatement {
  const argument = node.expression
    ? transformExpression(node.expression, checker)
    : { type: "string" as const, value: "Error" };
  return { type: "throw", argument, loc: getLoc(node) };
}

function transformTryStatement(
  node: ts.TryStatement,
  checker: ts.TypeChecker | undefined,
): TryStatement {
  const tryBlock = transformBlock(node.tryBlock, checker);

  let catchParam: string | null = null;
  let catchBody: BlockStatement | null = null;
  if (node.catchClause) {
    catchParam =
      node.catchClause.variableDeclaration &&
      ts.isIdentifier(node.catchClause.variableDeclaration.name)
        ? node.catchClause.variableDeclaration.name.text
        : "e";
    catchBody = transformBlock(node.catchClause.block, checker);
  }

  let finallyBlock: BlockStatement | null = null;
  if (node.finallyBlock) {
    finallyBlock = transformBlock(node.finallyBlock, checker);
  }

  return { type: "try", tryBlock, catchParam, catchBody, finallyBlock, loc: getLoc(node) };
}

export function transformBlock(
  block: ts.Block,
  checker: ts.TypeChecker | undefined,
): BlockStatement {
  const statements: Statement[] = [];
  for (const stmt of block.statements) {
    const transformed = transformStatement(stmt, checker);
    if (transformed) {
      statements.push(transformed);
    }
  }
  return { type: "block", statements };
}

function wrapInBlock(statement: ts.Statement, checker: ts.TypeChecker | undefined): BlockStatement {
  if (ts.isBlock(statement)) {
    return transformBlock(statement, checker);
  }

  const transformed = transformStatement(statement, checker);
  return { type: "block", statements: transformed ? [transformed] : [] };
}

function transformSwitchToIfElse(
  node: ts.SwitchStatement,
  checker: ts.TypeChecker | undefined,
): IfStatement {
  const switchExpr = transformExpression(node.expression, checker);

  const clauses = node.caseBlock.clauses;
  let result: IfStatement | null = null;
  let current: IfStatement | null = null;
  let pendingConditions: Expression[] = [];

  for (const clause of clauses) {
    if (ts.isCaseClause(clause)) {
      const caseExpr = transformExpression(clause.expression, checker);
      const condition: Expression = {
        type: "binary",
        op: "===",
        left: switchExpr,
        right: caseExpr,
      };

      const statements: Statement[] = [];
      for (const stmt of clause.statements) {
        if (stmt.kind === ts.SyntaxKind.BreakStatement) continue;
        const transformed = transformStatement(stmt, checker);
        if (transformed) statements.push(transformed);
      }

      if (statements.length === 0) {
        pendingConditions.push(condition);
      } else {
        let finalCondition: Expression = condition;
        for (let k = pendingConditions.length - 1; k >= 0; k--) {
          finalCondition = {
            type: "binary",
            op: "||",
            left: pendingConditions[k],
            right: finalCondition,
          };
        }
        pendingConditions = [];

        const ifStmt: IfStatement = {
          type: "if",
          condition: finalCondition,
          thenBlock: { type: "block", statements },
          elseBlock: null,
        };

        if (!result) {
          result = ifStmt;
          current = ifStmt;
        } else if (current) {
          current.elseBlock = { type: "block", statements: [ifStmt] };
          current = ifStmt;
        }
      }
    } else if (ts.isDefaultClause(clause)) {
      const statements: Statement[] = [];
      for (const stmt of clause.statements) {
        if (stmt.kind === ts.SyntaxKind.BreakStatement) continue;
        const transformed = transformStatement(stmt, checker);
        if (transformed) statements.push(transformed);
      }

      if (current) {
        current.elseBlock = { type: "block", statements };
      }
    }
  }

  return (
    result || {
      type: "if",
      condition: { type: "boolean", value: false },
      thenBlock: { type: "block", statements: [] },
      elseBlock: null,
    }
  );
}
