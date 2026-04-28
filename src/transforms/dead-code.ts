import type { HIRModule, HIRStmt, HIRFunction } from "../hir/types.js";

function isTerminator(stmt: HIRStmt): boolean {
  switch (stmt.kind) {
    case "return":
    case "throw":
    case "break":
    case "continue":
      return true;
    default:
      return false;
  }
}

function trimBlock(stmts: HIRStmt[]): HIRStmt[] {
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    switch (stmt.kind) {
      case "if":
        stmt.then = trimBlock(stmt.then);
        if (stmt.else) stmt.else = trimBlock(stmt.else);
        break;
      case "while":
      case "for":
        stmt.body = trimBlock(stmt.body);
        break;
      case "switch":
        for (const c of stmt.cases) c.body = trimBlock(c.body);
        break;
      case "try":
        stmt.body = trimBlock(stmt.body);
        if (stmt.catch) stmt.catch.body = trimBlock(stmt.catch.body);
        if (stmt.finally) stmt.finally = trimBlock(stmt.finally);
        break;
    }
    if (isTerminator(stmt)) {
      return stmts.slice(0, i + 1);
    }
  }
  return stmts;
}

function trimFunction(fn: HIRFunction): void {
  fn.body = trimBlock(fn.body);
}

export function deadCodePass(mod: HIRModule): void {
  for (const fn of mod.functions) trimFunction(fn);
  for (const cls of mod.classes) {
    for (const method of cls.methods) trimFunction(method);
  }
  mod.init = trimBlock(mod.init);
}
