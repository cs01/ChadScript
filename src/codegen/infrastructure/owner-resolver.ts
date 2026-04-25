import type { Expression, VariableNode, MemberAccessNode } from "../../ast/types.js";
import { stripNullable } from "./type-system.js";

interface ExprBase {
  type: string;
}

export function resolveOwnerClass(
  expr: Expression,
  getCurrentClassName: () => string | null,
  getClassVarName: (varName: string) => string | null,
  getFieldTsType: (className: string, fieldName: string) => string | null,
  isClassType: (typeName: string) => boolean,
): string | null {
  const base = expr as ExprBase;

  if (base.type === "this") {
    return getCurrentClassName();
  }

  if (base.type === "variable") {
    return getClassVarName((expr as VariableNode).name);
  }

  if (base.type === "member_access") {
    const ma = expr as MemberAccessNode;
    const ownerClass = resolveOwnerClass(
      ma.object,
      getCurrentClassName,
      getClassVarName,
      getFieldTsType,
      isClassType,
    );
    if (!ownerClass) return null;
    const tsType = getFieldTsType(ownerClass, ma.property);
    if (!tsType) return null;
    const stripped = stripNullable(tsType);
    if (stripped.endsWith("[]") || stripped.startsWith("Map<") || stripped.startsWith("Set<")) {
      return null;
    }
    if (isClassType(stripped)) return stripped;
    return null;
  }

  return null;
}
