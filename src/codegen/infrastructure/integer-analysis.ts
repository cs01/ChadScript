// Static analysis to find variables safe to keep as native i64 instead of double.
// Used by both function-level and global-level codegen to enable integer optimization.
// NOTE: This code must work under BOTH node and native compilers. Avoid Set, for...of,
// and other patterns that break self-hosting.

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
  private candidateNames: string[] = [];

  private hasCandidate(name: string): boolean {
    for (let i = 0; i < this.candidateNames.length; i++) {
      if (this.candidateNames[i] === name) return true;
    }
    return false;
  }

  private removeCandidate(name: string): void {
    const next: string[] = [];
    for (let i = 0; i < this.candidateNames.length; i++) {
      if (this.candidateNames[i] !== name) {
        next.push(this.candidateNames[i]);
      }
    }
    this.candidateNames = next;
  }

  private isIntegerLiteral(val: Expression): boolean {
    if (val.type !== "number") return false;
    return (val as NumberNode).value % 1 === 0;
  }

  private isIntegerExpressionForCandidacy(val: Expression): boolean {
    if (this.isIntegerLiteral(val)) return true;
    if (val.type === "variable") {
      return this.hasCandidate((val as VariableNode).name);
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
      )
        return true;
      const obj = mc.object as VariableNode;
      if (obj.type === "variable" && obj.name === "Math") {
        if (method === "floor" || method === "ceil" || method === "round" || method === "trunc")
          return true;
      }
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
        return (
          this.isIntegerExpressionForCandidacy(bin.left) &&
          this.isIntegerExpressionForCandidacy(bin.right)
        );
      }
    }
    if (val.type === "unary") {
      const un = val as UnaryNode;
      if (un.op === "-" || un.op === "~" || un.op === "+") {
        return this.isIntegerExpressionForCandidacy(un.operand);
      }
    }
    return false;
  }

  private isIntegerExpression(val: Expression): boolean {
    if (this.isIntegerLiteral(val)) return true;

    if (val.type === "variable") {
      return this.hasCandidate((val as VariableNode).name);
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

    return false;
  }

  private collectVarDecls(stmts: Statement[], out: VariableDeclaration[]): void {
    for (let si = 0; si < stmts.length; si++) {
      const stmt = stmts[si];
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
    for (let si = 0; si < stmts.length; si++) {
      const stmt = stmts[si];
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
    const pendingDecls: VariableDeclaration[] = [];

    // Pass 1: collect candidates with simple integer initializers (no variable refs)
    this.candidateNames = [];
    for (let di = 0; di < allDecls.length; di++) {
      const varDecl = allDecls[di];
      if (!varDecl.value) continue;
      if (this.isIntegerExpressionForCandidacy(varDecl.value)) {
        candidates.push(varDecl.name);
        isConst.push(varDecl.kind === "const");
        this.candidateNames.push(varDecl.name);
      } else {
        pendingDecls.push(varDecl);
      }
    }

    // Pass 2: re-check rejected decls now that candidateNames is populated
    // This handles `m = p * p` where `p` was identified in pass 1
    let currentPending = pendingDecls;
    let added = true;
    while (added) {
      added = false;
      const nextPending: VariableDeclaration[] = [];
      for (let pi = 0; pi < currentPending.length; pi++) {
        const varDecl = currentPending[pi];
        if (!varDecl.value) continue;
        if (this.isIntegerExpressionForCandidacy(varDecl.value)) {
          candidates.push(varDecl.name);
          isConst.push(varDecl.kind === "const");
          this.candidateNames.push(varDecl.name);
          added = true;
        } else {
          nextPending.push(varDecl);
        }
      }
      currentPending = nextPending;
    }

    if (candidates.length === 0) return [];

    const isDemoted: boolean[] = [];
    for (let k = 0; k < candidates.length; k++) {
      isDemoted.push(false);
    }

    const allAssignments: AssignmentStatement[] = [];
    this.collectNestedAssignments(statements, allAssignments);

    let changed = true;
    while (changed) {
      changed = false;
      for (let ai = 0; ai < allAssignments.length; ai++) {
        const stmt = allAssignments[ai];
        for (let j = 0; j < candidates.length; j++) {
          if (candidates[j] === stmt.name) {
            if (isConst[j]) break;
            if (!isDemoted[j] && !this.isIntegerExpression(stmt.value)) {
              isDemoted[j] = true;
              this.removeCandidate(candidates[j]);
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
