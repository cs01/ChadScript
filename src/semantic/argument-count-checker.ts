import type {
  AST,
  Expression,
  Statement,
  CallNode,
  NewNode,
  VariableDeclaration,
  AssignmentStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  ReturnStatement,
  ThrowStatement,
  BlockStatement,
  FunctionParameter,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

interface ParamInfo {
  min: number;
  max: number;
}

function argCountParams(params: string[], parameters?: FunctionParameter[]): ParamInfo {
  const max = params.length;
  if (!parameters || parameters.length === 0) {
    return { min: 0, max };
  }
  let min = 0;
  for (let i = 0; i < parameters.length; i++) {
    const p = parameters[i];
    if (!p.optional && !p.defaultValue) {
      min = min + 1;
    }
  }
  return { min, max };
}

function argBuildLookup(ast: AST): Map<string, ParamInfo> {
  const lookup = new Map<string, ParamInfo>();
  const duplicates: string[] = [];

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    if (fn.declare) continue;
    if (lookup.has(fn.name)) {
      duplicates.push(fn.name);
    } else {
      lookup.set(fn.name, argCountParams(fn.params, fn.parameters));
    }
  }

  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) {
      const method = cls.methods[j];
      if (method.isConstructor) {
        if (lookup.has(cls.name)) {
          duplicates.push(cls.name);
        } else {
          lookup.set(cls.name, argCountParams(method.params, method.parameters));
        }
      }
    }
  }

  for (let i = 0; i < duplicates.length; i++) {
    lookup.delete(duplicates[i]);
  }

  return lookup;
}

function argResolveAlias(name: string, ast: AST): string {
  const aliasNames = ast.importAliasNames;
  const aliasOriginals = ast.importAliasOriginals;
  if (aliasNames && aliasOriginals) {
    for (let i = 0; i < aliasNames.length; i++) {
      if (aliasNames[i] === name) {
        return aliasOriginals[i];
      }
    }
  }
  return name;
}

function argCheckCall(
  call: CallNode,
  lookup: Map<string, ParamInfo>,
  ast: AST,
  sourceCode: string,
): void {
  const resolved = argResolveAlias(call.name, ast);
  const info = lookup.get(resolved);
  if (!info) return;
  const argc = call.args.length;
  let hasSpread = false;
  for (let i = 0; i < call.args.length; i++) {
    if (call.args[i] && call.args[i].type === "spread_element") {
      hasSpread = true;
      break;
    }
  }
  if (hasSpread) return;
  if (argc < info.min) {
    const output = formatCompileError(
      sourceCode,
      "function '" + call.name + "' expects at least " + info.min + " argument(s) but got " + argc,
      call.loc,
      undefined,
      [],
    );
    process.stderr.write(output);
    process.exit(1);
  }
  if (argc > info.max) {
    const output = formatCompileError(
      sourceCode,
      "function '" + call.name + "' expects at most " + info.max + " argument(s) but got " + argc,
      call.loc,
      undefined,
      [],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}

function argCheckNew(
  n: NewNode,
  lookup: Map<string, ParamInfo>,
  ast: AST,
  sourceCode: string,
): void {
  const resolved = argResolveAlias(n.className, ast);
  const info = lookup.get(resolved);
  if (!info) return;
  const argc = n.args.length;
  let hasSpread = false;
  for (let i = 0; i < n.args.length; i++) {
    if (n.args[i] && n.args[i].type === "spread_element") {
      hasSpread = true;
      break;
    }
  }
  if (hasSpread) return;
  if (argc < info.min) {
    const output = formatCompileError(
      sourceCode,
      "constructor '" +
        n.className +
        "' expects at least " +
        info.min +
        " argument(s) but got " +
        argc,
      n.loc,
      undefined,
      [],
    );
    process.stderr.write(output);
    process.exit(1);
  }
  if (argc > info.max) {
    const output = formatCompileError(
      sourceCode,
      "constructor '" +
        n.className +
        "' expects at most " +
        info.max +
        " argument(s) but got " +
        argc,
      n.loc,
      undefined,
      [],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}

function argCheckExpr(
  expr: Expression,
  lookup: Map<string, ParamInfo>,
  ast: AST,
  sourceCode: string,
): void {
  if (!expr) return;
  const t = expr.type;

  if (t === "call") {
    const call = expr as CallNode;
    argCheckCall(call, lookup, ast, sourceCode);
  } else if (t === "new") {
    const n = expr as NewNode;
    argCheckNew(n, lookup, ast, sourceCode);
  }
}

function argWalkStatement(
  stmt: Statement,
  lookup: Map<string, ParamInfo>,
  ast: AST,
  sourceCode: string,
): void {
  const s = stmt as { type: string };
  const stype = s.type;

  if (stype === "variable_declaration") {
    const decl = stmt as VariableDeclaration;
    if (decl.value) {
      argCheckExpr(decl.value as Expression, lookup, ast, sourceCode);
    }
  } else if (stype === "assignment") {
    const assign = stmt as AssignmentStatement;
    argCheckExpr(assign.value, lookup, ast, sourceCode);
  } else if (stype === "if") {
    const ifStmt = stmt as IfStatement;
    argCheckExpr(ifStmt.condition, lookup, ast, sourceCode);
    argWalkBlock(ifStmt.thenBlock, lookup, ast, sourceCode);
    if (ifStmt.elseBlock) {
      argWalkBlock(ifStmt.elseBlock, lookup, ast, sourceCode);
    }
  } else if (stype === "while") {
    const whileStmt = stmt as WhileStatement;
    argCheckExpr(whileStmt.condition, lookup, ast, sourceCode);
    argWalkBlock(whileStmt.body, lookup, ast, sourceCode);
  } else if (stype === "do_while") {
    const doWhileStmt = stmt as DoWhileStatement;
    argWalkBlock(doWhileStmt.body, lookup, ast, sourceCode);
    argCheckExpr(doWhileStmt.condition, lookup, ast, sourceCode);
  } else if (stype === "for") {
    const forStmt = stmt as ForStatement;
    if (forStmt.init) {
      argWalkStatement(forStmt.init as Statement, lookup, ast, sourceCode);
    }
    if (forStmt.condition) {
      argCheckExpr(forStmt.condition, lookup, ast, sourceCode);
    }
    if (forStmt.update) {
      const upd = forStmt.update as { type: string };
      if (upd.type === "assignment") {
        argWalkStatement(forStmt.update as Statement, lookup, ast, sourceCode);
      } else {
        argCheckExpr(forStmt.update as Expression, lookup, ast, sourceCode);
      }
    }
    argWalkBlock(forStmt.body, lookup, ast, sourceCode);
  } else if (stype === "for_of") {
    const forOfStmt = stmt as ForOfStatement;
    argCheckExpr(forOfStmt.iterable, lookup, ast, sourceCode);
    argWalkBlock(forOfStmt.body, lookup, ast, sourceCode);
  } else if (stype === "try") {
    const tryStmt = stmt as TryStatement;
    argWalkBlock(tryStmt.tryBlock, lookup, ast, sourceCode);
    if (tryStmt.catchBody) {
      argWalkBlock(tryStmt.catchBody, lookup, ast, sourceCode);
    }
    if (tryStmt.finallyBlock) {
      argWalkBlock(tryStmt.finallyBlock, lookup, ast, sourceCode);
    }
  } else if (stype === "switch") {
    const switchStmt = stmt as SwitchStatement;
    argCheckExpr(switchStmt.discriminant, lookup, ast, sourceCode);
    for (let ci = 0; ci < switchStmt.cases.length; ci++) {
      const c = switchStmt.cases[ci];
      if (c.test) {
        argCheckExpr(c.test as Expression, lookup, ast, sourceCode);
      }
      argWalkStatements(c.consequent, lookup, ast, sourceCode);
    }
  } else if (stype === "return") {
    const retStmt = stmt as ReturnStatement;
    if (retStmt.value) {
      argCheckExpr(retStmt.value as Expression, lookup, ast, sourceCode);
    }
  } else if (stype === "throw") {
    const throwStmt = stmt as ThrowStatement;
    argCheckExpr(throwStmt.argument, lookup, ast, sourceCode);
  } else if (stype === "block") {
    argWalkBlock(stmt as BlockStatement, lookup, ast, sourceCode);
  } else if (stype !== "break" && stype !== "continue") {
    argCheckExpr(stmt as Expression, lookup, ast, sourceCode);
  }
}

function argWalkStatements(
  stmts: Statement[],
  lookup: Map<string, ParamInfo>,
  ast: AST,
  sourceCode: string,
): void {
  for (let i = 0; i < stmts.length; i++) {
    argWalkStatement(stmts[i], lookup, ast, sourceCode);
  }
}

function argWalkBlock(
  block: BlockStatement,
  lookup: Map<string, ParamInfo>,
  ast: AST,
  sourceCode: string,
): void {
  argWalkStatements(block.statements, lookup, ast, sourceCode);
}

export function checkArgumentCounts(ast: AST, sourceCode: string): void {
  const lookup = argBuildLookup(ast);
  if (lookup.size === 0) return;

  const items = ast.topLevelItems;
  if (items) {
    argWalkStatements(items as Statement[], lookup, ast, sourceCode);
  }

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    argWalkBlock(fn.body, lookup, ast, sourceCode);
  }

  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) {
      argWalkBlock(cls.methods[j].body, lookup, ast, sourceCode);
    }
  }
}
