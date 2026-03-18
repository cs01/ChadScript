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
  BinaryNode,
  UnaryNode,
  VariableNode,
  MemberAccessNode,
  MethodCallNode,
  CallNode,
} from "../../ast/types.js";

class IntegerAnalyzer {
  private candidateSet: Set<string> = new Set();

  private isIntegerLiteral(val: Expression): boolean {
    if (val.type !== "number") return false;
    return (val as NumberNode).value % 1 === 0;
  }

  private isIntegerExpression(val: Expression): boolean {
    if (this.isIntegerLiteral(val)) return true;

    if (val.type === "variable") {
      return this.candidateSet.has((val as VariableNode).name);
    }

    if (val.type === "binary") {
      const bin = val as BinaryNode;
      const op = bin.op;
      if (
        op === "+" ||
        op === "-" ||
        op === "*" ||
        op === "%" ||
        op === "&" ||
        op === "|" ||
        op === "^" ||
        op === "<<" ||
        op === ">>" ||
        op === ">>>"
      ) {
        return this.isIntegerExpression(bin.left) && this.isIntegerExpression(bin.right);
      }
      return false;
    }

    if (val.type === "unary") {
      const un = val as UnaryNode;
      if (un.op === "-" || un.op === "~" || un.op === "+") {
        return this.isIntegerExpression(un.operand);
      }
    }

    if (val.type === "member_access") {
      const ma = val as MemberAccessNode;
      if (ma.property === "length") return true;
    }

    if (val.type === "method_call") {
      const mc = val as MethodCallNode;
      const method = mc.method;
      if (
        method === "indexOf" ||
        method === "lastIndexOf" ||
        method === "findIndex" ||
        method === "charCodeAt"
      ) {
        return true;
      }
      const obj = mc.object as VariableNode;
      if (obj.type === "variable" && obj.name === "Math") {
        if (method === "floor" || method === "ceil" || method === "round" || method === "trunc") {
          return true;
        }
      }
    }

    if (val.type === "call") {
      const call = val as CallNode;
      if (call.name === "parseInt") return true;
    }

    return false;
  }

  private collectVarDecls(stmts: Statement[], out: VariableDeclaration[]): void {
    for (const stmt of stmts) {
      if (stmt.type === "variable_declaration") {
        out.push(stmt as VariableDeclaration);
      } else if (stmt.type === "for") {
        const forStmt = stmt as ForStatement;
        if (forStmt.init && forStmt.init.type === "variable_declaration") {
          out.push(forStmt.init as VariableDeclaration);
        }
        this.collectVarDecls(forStmt.body.statements, out);
      } else if (stmt.type === "while" || stmt.type === "do_while") {
        const loop = stmt as WhileStatement;
        this.collectVarDecls(loop.body.statements, out);
      } else if (stmt.type === "if") {
        const ifStmt = stmt as IfStatement;
        this.collectVarDecls(ifStmt.thenBlock.statements, out);
        if (ifStmt.elseBlock) {
          this.collectVarDecls(ifStmt.elseBlock.statements, out);
        }
      }
    }
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
        if (forStmt.update && (forStmt.update as Statement).type === "assignment") {
          out.push(forStmt.update as AssignmentStatement);
        }
        if (forStmt.init && (forStmt.init as Statement).type === "assignment") {
          out.push(forStmt.init as AssignmentStatement);
        }
        this.collectNestedAssignments(forStmt.body.statements, out);
      }
    }
  }

  findI64EligibleVariables(statements: Statement[]): string[] {
    if (!statements || !statements.length) return [];

    const allDecls: VariableDeclaration[] = [];
    this.collectVarDecls(statements, allDecls);

    const candidates: string[] = [];
    const isConst: boolean[] = [];

    for (const varDecl of allDecls) {
      if (!varDecl.value) continue;
      if (this.isIntegerLiteral(varDecl.value)) {
        candidates.push(varDecl.name);
        isConst.push(varDecl.kind === "const");
      }
    }

    if (candidates.length === 0) return [];

    this.candidateSet = new Set(candidates);

    const isDemoted: boolean[] = [];
    for (let k = 0; k < candidates.length; k++) {
      isDemoted.push(false);
    }

    const allAssignments: AssignmentStatement[] = [];
    this.collectNestedAssignments(statements, allAssignments);

    let changed = true;
    while (changed) {
      changed = false;
      for (const stmt of allAssignments) {
        for (let j = 0; j < candidates.length; j++) {
          if (candidates[j] === stmt.name) {
            if (isConst[j]) break;
            if (!isDemoted[j] && !this.isIntegerExpression(stmt.value)) {
              isDemoted[j] = true;
              this.candidateSet.delete(candidates[j]);
              changed = true;
            }
            break;
          }
        }
      }
    }

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
