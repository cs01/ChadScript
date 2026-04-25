import type {
  AST,
  SourceLocation,
  VariableDeclaration,
  Expression,
  ClassNode,
  FunctionNode,
  Statement,
  BlockStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  MapNode,
  NewNode,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

function isMapNumberKey(typeStr: string): string | null {
  if (!typeStr) return null;
  const trimmed = typeStr.trim();
  if (!trimmed.startsWith("Map<")) return null;
  if (!trimmed.endsWith(">")) return null;
  const inner = trimmed.substring(4, trimmed.length - 1);
  let depth = 0;
  let commaIdx = -1;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<") {
      depth = depth + 1;
    } else if (ch === ">") {
      depth = depth - 1;
    } else if (ch === "," && depth === 0) {
      commaIdx = i;
      break;
    }
  }
  if (commaIdx === -1) return null;
  const keyType = inner.substring(0, commaIdx).trim();
  if (keyType !== "number") return null;
  const valueType = inner.substring(commaIdx + 1).trim();
  if (valueType === "number" || valueType === "boolean") return null;
  return valueType;
}

function emitMapKeyError(
  valueType: string,
  loc: SourceLocation | undefined,
  sourceCode: string,
): void {
  const output = formatCompileError(
    sourceCode,
    `Map<number, ${valueType}> is not supported. Use Map<string, ${valueType}> instead`,
    loc,
    undefined,
    [],
  );
  process.stderr.write(output);
  process.exit(1);
}

function checkTypeStr(typeStr: string, loc: SourceLocation | undefined, sourceCode: string): void {
  const vt = isMapNumberKey(typeStr);
  if (vt !== null) {
    emitMapKeyError(vt, loc, sourceCode);
  }
}

function checkMapExpr(expr: Expression, sourceCode: string): void {
  const m = expr as unknown as MapNode;
  if (
    m.keyType === "number" &&
    m.valueType &&
    m.valueType !== "number" &&
    m.valueType !== "boolean"
  ) {
    emitMapKeyError(m.valueType, m.loc, sourceCode);
  }
}

function checkNewExpr(expr: Expression, sourceCode: string): void {
  const n = expr as unknown as NewNode;
  if (n.className !== "Map") return;
  if (!n.typeArgs || n.typeArgs.length < 2) return;
  if (n.typeArgs[0] !== "number") return;
  const vt = n.typeArgs[1];
  if (vt === "number" || vt === "boolean") return;
  emitMapKeyError(vt, n.loc, sourceCode);
}

function checkExpr(expr: Expression | null, sourceCode: string): void {
  if (!expr) return;
  const exprType = (expr as unknown as MapNode).type;
  if (exprType === "map") {
    checkMapExpr(expr, sourceCode);
  } else if (exprType === "new") {
    checkNewExpr(expr, sourceCode);
  }
}

function walkMapCheckBlock(block: BlockStatement, sourceCode: string): void {
  if (!block || !block.statements) return;
  for (let i = 0; i < block.statements.length; i++) {
    walkMapCheckStmt(block.statements[i], sourceCode);
  }
}

function walkMapCheckStmt(stmt: Statement, sourceCode: string): void {
  if (!stmt) return;
  const t = (stmt as VariableDeclaration).type;
  if (!t) return;

  if (t === "variable_declaration") {
    const decl = stmt as VariableDeclaration;
    if (decl.declaredType) {
      checkTypeStr(decl.declaredType, decl.loc, sourceCode);
    }
    checkExpr(decl.value, sourceCode);
  } else if (t === "if") {
    const ifStmt = stmt as IfStatement;
    walkMapCheckBlock(ifStmt.thenBlock, sourceCode);
    if (ifStmt.elseBlock) walkMapCheckBlock(ifStmt.elseBlock, sourceCode);
  } else if (t === "while") {
    walkMapCheckBlock((stmt as WhileStatement).body, sourceCode);
  } else if (t === "do_while") {
    walkMapCheckBlock((stmt as DoWhileStatement).body, sourceCode);
  } else if (t === "for") {
    const forStmt = stmt as ForStatement;
    if (forStmt.init) walkMapCheckStmt(forStmt.init as Statement, sourceCode);
    walkMapCheckBlock(forStmt.body, sourceCode);
  } else if (t === "for_of") {
    walkMapCheckBlock((stmt as ForOfStatement).body, sourceCode);
  } else if (t === "try") {
    const tryStmt = stmt as TryStatement;
    walkMapCheckBlock(tryStmt.tryBlock, sourceCode);
    if (tryStmt.catchBody) walkMapCheckBlock(tryStmt.catchBody, sourceCode);
    if (tryStmt.finallyBlock) walkMapCheckBlock(tryStmt.finallyBlock, sourceCode);
  } else if (t === "block") {
    walkMapCheckBlock(stmt as BlockStatement, sourceCode);
  }
}

export function checkMapKeyTypes(ast: AST, sourceCode: string): void {
  for (let i = 0; i < ast.topLevelStatements.length; i++) {
    const stmt = ast.topLevelStatements[i] as VariableDeclaration;
    if (stmt.type === "variable_declaration") {
      if (stmt.declaredType) {
        checkTypeStr(stmt.declaredType, stmt.loc, sourceCode);
      }
      checkExpr(stmt.value, sourceCode);
    }
  }

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i] as FunctionNode;
    walkMapCheckBlock(fn.body, sourceCode);
  }

  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i] as ClassNode;
    for (let j = 0; j < cls.fields.length; j++) {
      const field = cls.fields[j];
      if (field.tsType) {
        checkTypeStr(field.tsType, cls.loc, sourceCode);
      }
    }
    for (let k = 0; k < cls.methods.length; k++) {
      walkMapCheckBlock(cls.methods[k].body, sourceCode);
    }
  }
}
