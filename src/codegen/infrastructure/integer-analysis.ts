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

  // Pass 2: Scan assignments to demote let variables with non-integer RHS
  const isDemoted: boolean[] = [];
  for (let k = 0; k < candidates.length; k++) {
    isDemoted.push(false);
  }

  for (let i = 0; i < len; i++) {
    const stmt = statements[i];
    if (!stmt) continue;
    const stmtTyped = stmt as { type: string; name?: string; value?: unknown };
    if (!stmtTyped.type) continue;
    if (stmtTyped.type !== "assignment") continue;
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
