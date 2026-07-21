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
  ReturnStatement,
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
    const num = val as NumberNode;
    if (num.isFloat === true) return false;
    return num.value % 1 === 0;
  }

  private isIntegerExpressionForCandidacy(val: Expression): boolean {
    if (this.isIntegerLiteral(val)) return true;
    if (val.type === "variable") {
      const name = (val as VariableNode).name;
      if (name === "NaN" || name === "Infinity") return false;
      return true;
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

  private addUniqueName(arr: string[], name: string): void {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === name) return;
    }
    arr.push(name);
  }

  private containsName(arr: string[], name: string): boolean {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === name) return true;
    }
    return false;
  }

  // Collect variable names used as an argument to a Math.* builtin. Narrowing such a variable
  // to i64 truncates its fractional part before the builtin runs (e.g. Math.ceil(x) with
  // x=3.2 computes ceil(3)=3 instead of 4), so these variables must be excluded from
  // integer narrowing. Conservative: narrowing fewer variables is always correct.
  private collectMathArgVars(stmts: Statement[], out: string[]): void {
    for (let si = 0; si < stmts.length; si++) {
      this.scanStatementForMathArgs(stmts[si], out);
    }
  }

  private scanStatementForMathArgs(stmt: Statement, out: string[]): void {
    if (!stmt) return;
    const t = stmt.type;
    if (t === "variable_declaration") {
      this.scanExprForMathArgs((stmt as VariableDeclaration).value, out);
    } else if (t === "assignment") {
      this.scanExprForMathArgs((stmt as AssignmentStatement).value, out);
    } else if (t === "return") {
      this.scanExprForMathArgs((stmt as ReturnStatement).value, out);
    } else if (t === "if") {
      const ifStmt = stmt as IfStatement;
      this.scanExprForMathArgs(ifStmt.condition, out);
      this.collectMathArgVars(ifStmt.thenBlock.statements, out);
      if (ifStmt.elseBlock) this.collectMathArgVars(ifStmt.elseBlock.statements, out);
    } else if (t === "while" || t === "do_while") {
      const loop = stmt as WhileStatement;
      this.scanExprForMathArgs(loop.condition, out);
      this.collectMathArgVars(loop.body.statements, out);
    } else if (t === "for") {
      const forStmt = stmt as ForStatement;
      if (forStmt.init) this.scanStatementForMathArgs(forStmt.init as Statement, out);
      if (forStmt.condition) this.scanExprForMathArgs(forStmt.condition, out);
      if (forStmt.update) this.scanStatementForMathArgs(forStmt.update as Statement, out);
      this.collectMathArgVars(forStmt.body.statements, out);
    } else {
      // Bare expression statement: the expression may be stored directly as the statement.
      this.scanExprForMathArgs(stmt as unknown as Expression, out);
    }
  }

  private scanExprForMathArgs(expr: Expression | null | undefined, out: string[]): void {
    if (!expr) return;
    const t = (expr as Expression).type;
    if (t === "method_call") {
      const mc = expr as MethodCallNode;
      const obj = mc.object as VariableNode;
      if (obj && obj.type === "variable" && obj.name === "Math") {
        for (let i = 0; i < mc.args.length; i++) {
          const a = mc.args[i] as VariableNode;
          if (a && a.type === "variable") this.addUniqueName(out, a.name);
        }
      }
      this.scanExprForMathArgs(mc.object, out);
      for (let i = 0; i < mc.args.length; i++) this.scanExprForMathArgs(mc.args[i], out);
    } else if (t === "call") {
      const c = expr as CallNode;
      for (let i = 0; i < c.args.length; i++) this.scanExprForMathArgs(c.args[i], out);
    } else if (t === "binary") {
      const b = expr as BinaryNode;
      this.scanExprForMathArgs(b.left, out);
      this.scanExprForMathArgs(b.right, out);
    } else if (t === "unary") {
      this.scanExprForMathArgs((expr as UnaryNode).operand, out);
    } else if (t === "member_access") {
      this.scanExprForMathArgs((expr as MemberAccessNode).object, out);
    }
  }

  findI64EligibleVariables(statements: Statement[], paramNames?: string[]): string[] {
    if (!statements || !statements.length) return [];

    const allDecls: VariableDeclaration[] = [];
    this.collectVarDecls(statements, allDecls);

    const candidates: string[] = [];
    const isConst: number[] = [];
    const pendingDecls: VariableDeclaration[] = [];

    // Variables consumed by a Math.* float builtin must never be narrowed (see method doc).
    // Excluding them up front also stops the narrowing from propagating (e.g. m = x * x).
    const floatVars: string[] = [];
    this.collectMathArgVars(statements, floatVars);

    this.candidateNames = [];
    if (paramNames) {
      for (let pi = 0; pi < paramNames.length; pi++) {
        if (this.containsName(floatVars, paramNames[pi])) continue;
        candidates.push(paramNames[pi]);
        isConst.push(0);
        this.candidateNames.push(paramNames[pi]);
      }
    }

    for (let di = 0; di < allDecls.length; di++) {
      const varDecl = allDecls[di];
      if (!varDecl.value) continue;
      if (this.containsName(floatVars, varDecl.name)) continue;
      if (this.isIntegerExpressionForCandidacy(varDecl.value)) {
        candidates.push(varDecl.name);
        isConst.push(varDecl.kind === "const" ? 1 : 0);
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
          isConst.push(varDecl.kind === "const" ? 1 : 0);
          this.candidateNames.push(varDecl.name);
          added = true;
        } else {
          nextPending.push(varDecl);
        }
      }
      currentPending = nextPending;
    }

    if (candidates.length === 0) return [];

    const isDemoted: number[] = [];
    for (let k = 0; k < candidates.length; k++) {
      isDemoted.push(0);
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
              isDemoted[j] = 1;
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

export function findI64EligibleVariables(statements: Statement[], paramNames?: string[]): string[] {
  return new IntegerAnalyzer().findI64EligibleVariables(statements, paramNames);
}
