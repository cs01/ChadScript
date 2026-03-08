// Static analysis to find variables safe to keep as native i64 instead of double.
// Used by both function-level and global-level codegen to enable integer optimization.

import type {
  Expression,
  Statement,
  AssignmentStatement,
  VariableDeclaration,
  WhileStatement,
  IfStatement,
  ForStatement,
  NumberNode,
} from "../../ast/types.js";

class IntegerAnalyzer {
  private isIntegerLiteral(val: Expression): boolean {
    if (val.type !== "number") return false;
    return (val as NumberNode).value % 1 === 0;
  }

  private collectNestedAssignments(stmts: Statement[], out: AssignmentStatement[]): void {
    for (const stmt of stmts) {
      if (stmt.type === "assignment") {
        out.push(stmt as AssignmentStatement);
      } else if (stmt.type === "while" || stmt.type === "do_while") {
        const loop = stmt as WhileStatement;
        this.collectNestedAssignments(loop.body.statements, out);
      } else if (stmt.type === "if") {
        const ifStmt = stmt as IfStatement;
        this.collectNestedAssignments(ifStmt.thenBlock.statements, out);
        if (ifStmt.elseBlock) {
          this.collectNestedAssignments(ifStmt.elseBlock.statements, out);
        }
      } else if (stmt.type === "for") {
        const forStmt = stmt as ForStatement;
        this.collectNestedAssignments(forStmt.body.statements, out);
      }
    }
  }

  findI64EligibleVariables(statements: Statement[]): string[] {
    if (!statements || !statements.length) return [];

    const candidates: string[] = [];
    const isConst: boolean[] = [];

    // Pass 1: Collect variables initialized with integer literals
    for (const stmt of statements) {
      if (stmt.type !== "variable_declaration") continue;
      const varDecl = stmt as VariableDeclaration;
      if (!varDecl.value) continue;
      if (this.isIntegerLiteral(varDecl.value)) {
        candidates.push(varDecl.name);
        isConst.push(varDecl.kind === "const");
      }
    }

    if (candidates.length === 0) return [];

    // Pass 2: Scan all assignments (including inside loops/branches) to demote
    // variables that are ever assigned a non-integer value.
    const isDemoted: boolean[] = [];
    for (let k = 0; k < candidates.length; k++) {
      isDemoted.push(false);
    }

    const allAssignments: AssignmentStatement[] = [];
    this.collectNestedAssignments(statements, allAssignments);

    for (const stmt of allAssignments) {
      for (let j = 0; j < candidates.length; j++) {
        if (candidates[j] === stmt.name) {
          if (isConst[j]) break;
          if (!this.isIntegerLiteral(stmt.value)) {
            isDemoted[j] = true;
          }
          break;
        }
      }
    }

    // Build result: candidates minus demoted
    const result: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (!isDemoted[i]) {
        result.push(candidates[i]);
      }
    }
    return result;
  }
}

export function findI64EligibleVariables(statements: Statement[]): string[] {
  return new IntegerAnalyzer().findI64EligibleVariables(statements);
}
