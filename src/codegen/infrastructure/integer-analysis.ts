// Static analysis to find variables safe to keep as native i64 instead of double.
// Used by both function-level and global-level codegen to enable integer optimization.
//
// NOTE: The parameter uses `object[]` instead of `Statement[]` because `Statement`
// is a union type, and standalone functions with union-type parameters cause codegen
// issues in the native compiler (the type name gets emitted literally). Using `object[]`
// ensures the ObjectArray is passed through correctly.

// Returns true if the expression is an integer literal.
function isIntegerLiteral(val: object): boolean {
  const expr = val as { type: string; value?: number };
  if (!expr || !expr.type) return false;
  if (expr.type !== "number") return false;
  const v = expr.value;
  if (v === null || v === undefined) return false;
  return v % 1 === 0;
}

function getBlockStatements(block: object): object[] {
  const b = block as { type: string; statements: object[] };
  return b.statements;
}

function collectNestedAssignments(stmts: object[], out: object[]): void {
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    if (!stmt) continue;
    const stmtBase = stmt as { type: string };
    if (!stmtBase.type) continue;

    if (stmtBase.type === "assignment") {
      out.push(stmt);
    } else if (stmtBase.type === "while" || stmtBase.type === "do_while") {
      // WhileStatement: { type, condition, body, loc } — body at field index 2
      const asWhile = stmt as { type: string; condition: object; body: object };
      collectNestedAssignments(getBlockStatements(asWhile.body), out);
    } else if (stmtBase.type === "if") {
      // IfStatement: { type, condition, thenBlock, elseBlock, loc } — thenBlock=2, elseBlock=3
      const asIf = stmt as {
        type: string;
        condition: object;
        thenBlock: object;
        elseBlock: object;
      };
      collectNestedAssignments(getBlockStatements(asIf.thenBlock), out);
      if (asIf.elseBlock) {
        collectNestedAssignments(getBlockStatements(asIf.elseBlock), out);
      }
    } else if (stmtBase.type === "for") {
      // ForStatement: { type, init, condition, update, body, loc } — body at field index 4
      const asFor = stmt as {
        type: string;
        init: object;
        condition: object;
        update: object;
        body: object;
      };
      collectNestedAssignments(getBlockStatements(asFor.body), out);
    }
  }
}

export function findI64EligibleVariables(statements: object[]): string[] {
  if (!statements || !statements.length) return [];
  const len = statements.length;

  const candidates: string[] = [];
  const isConst: boolean[] = [];

  // Pass 1: Collect variables initialized with integer literals
  for (let i = 0; i < len; i++) {
    const stmt = statements[i];
    if (!stmt) continue;
    const stmtTyped = stmt as { type: string; kind?: string; name?: string; value?: unknown };
    if (!stmtTyped.type) continue;
    if (stmtTyped.type !== "variable_declaration") continue;
    if (!stmtTyped.value || !stmtTyped.name) continue;
    if (isIntegerLiteral(stmtTyped.value)) {
      candidates.push(stmtTyped.name);
      isConst.push(stmtTyped.kind === "const");
    }
  }

  if (candidates.length === 0) return [];

  // Pass 2: Scan all assignments (including inside loops/branches) to demote
  // variables that are ever assigned a non-integer value.
  const isDemoted: boolean[] = [];
  for (let k = 0; k < candidates.length; k++) {
    isDemoted.push(false);
  }

  const allAssignments: object[] = [];
  collectNestedAssignments(statements, allAssignments);

  for (let i = 0; i < allAssignments.length; i++) {
    const stmt = allAssignments[i];
    const stmtTyped = stmt as { type: string; name?: string; value?: unknown };
    if (!stmtTyped.name || !stmtTyped.value) continue;
    for (let j = 0; j < candidates.length; j++) {
      if (candidates[j] === stmtTyped.name) {
        if (isConst[j]) break;
        if (!isIntegerLiteral(stmtTyped.value)) {
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
