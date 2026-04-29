import type { SyntaxNode } from "../parser-py.js";
import type { HIRType, HIRStmt, HIRExpr, HIRFunction } from "./types.js";

export interface Local {
  id: number;
  name: string;
  type: HIRType;
}

export interface FnInfo {
  params: HIRType[];
  returnType: HIRType;
  variadicIdx?: number;
}

export interface ClassInfo {
  fields: { name: string; type: HIRType }[];
}

export interface LowerCtx {
  locals: Map<string, Local>;
  functions: Map<string, FnInfo>;
  classes: Map<string, ClassInfo>;
  classParents: Map<string, string>;
  dynobjClasses: Set<string>;
  instanceClasses: Map<string, string>;
  currentClassName: string | null;
  pendingStmts: HIRStmt[];
  pendingFunctions: HIRFunction[];
  freshId: () => number;
  lowerExpr: (node: SyntaxNode) => HIRExpr;
  lowerStmt: (node: SyntaxNode) => HIRStmt[];
  lowerBlock: (node: SyntaxNode) => HIRStmt[];
  lowerFunctionNode: (node: SyntaxNode) => HIRFunction;
}
