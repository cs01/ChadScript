import type {
  AST,
  SourceLocation,
  VariableDeclaration,
  ClassNode,
  ClassField,
  ClassMethod,
  FunctionNode,
  MapNode,
  NewNode,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

function parseMapKeyValue(typeStr: string): { keyType: string; valueType: string } | null {
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
  const valueType = inner.substring(commaIdx + 1).trim();
  return { keyType, valueType };
}

function isUnsupportedMapKey(
  typeStr: string,
): { keyType: string; valueType: string; reason: string } | null {
  const parsed = parseMapKeyValue(typeStr);
  if (!parsed) return null;
  const { keyType, valueType } = parsed;
  if (keyType === "object") {
    return { keyType, valueType, reason: "unsupported_key" };
  }
  if (keyType === "number" && valueType !== "number" && valueType !== "boolean") {
    return { keyType, valueType, reason: "number_key_string_value" };
  }
  return null;
}

function emitMapKeyError(
  keyType: string,
  valueType: string,
  reason: string,
  loc: SourceLocation | undefined,
  sourceCode: string,
): void {
  let msg: string;
  if (reason === "unsupported_key") {
    msg = `Map<${keyType}, ${valueType}> is not supported. Only string and number keys are supported`;
  } else {
    msg = `Map<number, ${valueType}> is not supported. Use Map<string, ${valueType}> instead`;
  }
  const output = formatCompileError(sourceCode, msg, loc, undefined, []);
  process.stderr.write(output);
  process.exit(1);
}

function checkTypeStr(typeStr: string, loc: SourceLocation | undefined, sourceCode: string): void {
  const result = isUnsupportedMapKey(typeStr);
  if (result !== null) {
    emitMapKeyError(result.keyType, result.valueType, result.reason, loc, sourceCode);
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
    if (m.keyType === "object") {
      emitMapKeyError(m.keyType, m.valueType || "unknown", "unsupported_key", m.loc, sourceCode);
    } else if (
      m.keyType === "number" &&
      m.valueType &&
      m.valueType !== "number" &&
      m.valueType !== "boolean"
    ) {
      emitMapKeyError("number", m.valueType, "number_key_string_value", m.loc, sourceCode);
    }
  } else if (exprType === "new") {
    const n = decl.value as unknown as NewNode;
    if (n.className === "Map" && n.typeArgs && n.typeArgs.length >= 2) {
      const kt = n.typeArgs[0];
      const vt = n.typeArgs[1];
      if (kt === "object") {
        emitMapKeyError(kt, vt, "unsupported_key", n.loc, sourceCode);
      } else if (kt === "number" && vt !== "number" && vt !== "boolean") {
        emitMapKeyError(kt, vt, "number_key_string_value", n.loc, sourceCode);
      }
    }
  }
}

function checkParamTypes(
  paramTypes: string[] | undefined,
  loc: SourceLocation | undefined,
  sourceCode: string,
): void {
  if (!paramTypes) return;
  for (let i = 0; i < paramTypes.length; i++) {
    checkTypeStr(paramTypes[i], loc, sourceCode);
  }
}

function checkReturnType(
  returnType: string | undefined,
  loc: SourceLocation | undefined,
  sourceCode: string,
): void {
  if (!returnType) return;
  checkTypeStr(returnType, loc, sourceCode);
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
    for (let j = 0; j < cls.methods.length; j++) {
      const method = cls.methods[j] as ClassMethod;
      checkParamTypes(method.paramTypes, cls.loc, sourceCode);
      checkReturnType(method.returnType, cls.loc, sourceCode);
    }
  }

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i] as FunctionNode;
    checkParamTypes(fn.paramTypes, fn.loc, sourceCode);
    checkReturnType(fn.returnType, fn.loc, sourceCode);
  }
}
