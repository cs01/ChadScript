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
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

function parseMapType(s: string): { keyType: string; valueType: string } | null {
  if (!s) return null;
  const trimmed = s.trim();
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
  return {
    keyType: inner.substring(0, commaIdx).trim(),
    valueType: inner.substring(commaIdx + 1).trim(),
  };
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
  const parsed = parseMapType(typeStr);
  if (!parsed) return;
  if (parsed.keyType !== "number") return;
  if (parsed.valueType === "number" || parsed.valueType === "boolean") return;
  emitMapKeyError(parsed.valueType, loc, sourceCode);
}

function checkExpr(expr: Expression | null, sourceCode: string): void {
  if (!expr) return;
  const e = expr as {
    type: string;
    className?: string;
    typeArgs?: string[];
    keyType?: string;
    valueType?: string;
    loc?: SourceLocation;
  };
  if (e.type === "map") {
    if (
      e.keyType === "number" &&
      e.valueType &&
      e.valueType !== "number" &&
      e.valueType !== "boolean"
    ) {
      emitMapKeyError(e.valueType, e.loc, sourceCode);
    }
    return;
  }
  if (e.type !== "new") return;
  if (e.className !== "Map") return;
  if (!e.typeArgs || e.typeArgs.length < 2) return;
  if (e.typeArgs[0] !== "number") return;
  const vt = e.typeArgs[1];
  if (vt === "number" || vt === "boolean") return;
  emitMapKeyError(vt, e.loc, sourceCode);
}

function walkBlock(block: BlockStatement, sourceCode: string): void {
  if (!block || !block.statements) return;
  for (let i = 0; i < block.statements.length; i++) {
    walkStatement(block.statements[i], sourceCode);
  }
}

function walkStatement(stmt: Statement, sourceCode: string): void {
  if (!stmt) return;
  const t = (stmt as { type: string }).type;
  if (!t) return;

  if (t === "variable_declaration") {
    const decl = stmt as VariableDeclaration;
    if (decl.declaredType) {
      checkTypeStr(decl.declaredType, decl.loc, sourceCode);
    }
    checkExpr(decl.value, sourceCode);
  } else if (t === "if") {
    const ifStmt = stmt as IfStatement;
    walkBlock(ifStmt.thenBlock, sourceCode);
    if (ifStmt.elseBlock) walkBlock(ifStmt.elseBlock, sourceCode);
  } else if (t === "while") {
    walkBlock((stmt as WhileStatement).body, sourceCode);
  } else if (t === "do_while") {
    walkBlock((stmt as DoWhileStatement).body, sourceCode);
  } else if (t === "for") {
    const forStmt = stmt as ForStatement;
    if (forStmt.init) walkStatement(forStmt.init as Statement, sourceCode);
    walkBlock(forStmt.body, sourceCode);
  } else if (t === "for_of") {
    walkBlock((stmt as ForOfStatement).body, sourceCode);
  } else if (t === "try") {
    const tryStmt = stmt as TryStatement;
    walkBlock(tryStmt.tryBlock, sourceCode);
    if (tryStmt.catchBody) walkBlock(tryStmt.catchBody, sourceCode);
    if (tryStmt.finallyBlock) walkBlock(tryStmt.finallyBlock, sourceCode);
  } else if (t === "block") {
    walkBlock(stmt as BlockStatement, sourceCode);
  }
}

export function checkMapKeyTypes(ast: AST, sourceCode: string): void {
  for (let i = 0; i < ast.topLevelStatements.length; i++) {
    const stmt = ast.topLevelStatements[i] as { type: string };
    if (stmt.type === "variable_declaration") {
      const decl = ast.topLevelStatements[i] as unknown as VariableDeclaration;
      if (decl.declaredType) {
        checkTypeStr(decl.declaredType, decl.loc, sourceCode);
      }
      checkExpr(decl.value, sourceCode);
    }
  }

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i] as FunctionNode;
    walkBlock(fn.body, sourceCode);
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
      walkBlock(cls.methods[k].body, sourceCode);
    }
  }
}
