import type {
  AST,
  SourceLocation,
  VariableDeclaration,
  ClassNode,
  ClassField,
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

function checkVarDecl(decl: VariableDeclaration, sourceCode: string): void {
  if (decl.declaredType) {
    checkTypeStr(decl.declaredType, decl.loc, sourceCode);
  }
  if (!decl.value) return;
  const exprType = (decl.value as unknown as MapNode).type;
  if (exprType === "map") {
    const m = decl.value as unknown as MapNode;
    if (
      m.keyType === "number" &&
      m.valueType &&
      m.valueType !== "number" &&
      m.valueType !== "boolean"
    ) {
      emitMapKeyError(m.valueType, m.loc, sourceCode);
    }
  } else if (exprType === "new") {
    const n = decl.value as unknown as NewNode;
    if (n.className === "Map" && n.typeArgs && n.typeArgs.length >= 2) {
      if (n.typeArgs[0] === "number") {
        const vt = n.typeArgs[1];
        if (vt !== "number" && vt !== "boolean") {
          emitMapKeyError(vt, n.loc, sourceCode);
        }
      }
    }
  }
}

export function checkMapKeyTypes(ast: AST, sourceCode: string): void {
  for (let i = 0; i < ast.topLevelStatements.length; i++) {
    const stmt = ast.topLevelStatements[i] as VariableDeclaration;
    if (stmt.type === "variable_declaration") {
      checkVarDecl(stmt, sourceCode);
    }
  }

  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i] as ClassNode;
    for (let j = 0; j < cls.fields.length; j++) {
      const field = cls.fields[j] as ClassField;
      if (field.tsType) {
        checkTypeStr(field.tsType, cls.loc, sourceCode);
      }
    }
  }
}
