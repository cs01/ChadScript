// Closure mutation checker — semantic pass run before IR generation.
// ChadScript closures capture by value, so mutations to a variable after it has been
// captured produce silently incorrect results. This pass detects such mutations and
// turns them into a compile error with a clear message.

import { ClosureAnalyzer } from "../codegen/infrastructure/closure-analyzer.js";
import type {
  AST,
  Statement,
  Expression,
  BlockStatement,
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
  ArrowFunctionNode,
  ObjectProperty,
  MapEntry,
  SourceLocation,
} from "../ast/types.js";

export function checkClosureMutations(ast: AST): void {
  const checker = new ClosureMutationChecker();
  checker.checkAST(ast);
}

class ClosureMutationChecker {
  private analyzer: ClosureAnalyzer;

  constructor() {
    this.analyzer = new ClosureAnalyzer();
  }

  checkAST(ast: AST): void {
    // Walk all top-level items in source order.
    // topLevelItems is the combined ordered list of declarations + expressions.
    const items = ast.topLevelItems;
    if (items && items.length > 0) {
      this.walkStatements(items as Statement[], [], []);
    }

    // Walk each standalone function body (fresh scope per function).
    for (let i = 0; i < ast.functions.length; i++) {
      const fn = ast.functions[i];
      // Function params are in scope for the entire body.
      this.walkBlock(fn.body, fn.params.slice(), []);
    }

    // Walk each class method body (fresh scope per method).
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        const method = cls.methods[j];
        this.walkBlock(method.body, method.params.slice(), []);
      }
    }
  }

  private walkStatements(
    stmts: Statement[],
    scopeVarNames: string[],
    capturedNames: string[],
  ): void {
    for (let i = 0; i < stmts.length; i++) {
      this.walkStatement(stmts[i], scopeVarNames, capturedNames);
    }
  }

  private walkBlock(block: BlockStatement, scopeVarNames: string[], capturedNames: string[]): void {
    this.walkStatements(block.statements, scopeVarNames, capturedNames);
  }

  private walkStatement(stmt: Statement, scopeVarNames: string[], capturedNames: string[]): void {
    const s = stmt as { type: string };
    const stype = s.type;

    if (stype === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      // Scan the initializer for arrow functions before adding the var to scope
      // (the variable is not in scope inside its own initializer).
      if (decl.value !== null && decl.value !== undefined) {
        this.scanExprForCaptures(decl.value as Expression, scopeVarNames, capturedNames);
      }
      scopeVarNames.push(decl.name);
    } else if (stype === "assignment") {
      const assign = stmt as AssignmentStatement;
      // Simple-name reassignment after capture is the error we're looking for.
      // Member-access assignments (obj.x = y) don't reassign the binding itself.
      if (capturedNames.indexOf(assign.name) !== -1) {
        this.reportError(assign.name, assign.loc);
      }
      this.scanExprForCaptures(assign.value, scopeVarNames, capturedNames);
    } else if (stype === "if") {
      const ifStmt = stmt as IfStatement;
      this.scanExprForCaptures(ifStmt.condition, scopeVarNames, capturedNames);
      // Pass a scope copy into each branch so declarations there don't escape.
      // capturedNames is shared: captures inside a branch still protect against
      // mutations that appear later in the outer scope.
      this.walkBlock(ifStmt.thenBlock, scopeVarNames.slice(), capturedNames);
      if (ifStmt.elseBlock !== null && ifStmt.elseBlock !== undefined) {
        this.walkBlock(ifStmt.elseBlock, scopeVarNames.slice(), capturedNames);
      }
    } else if (stype === "while") {
      const whileStmt = stmt as WhileStatement;
      this.scanExprForCaptures(whileStmt.condition, scopeVarNames, capturedNames);
      this.walkBlock(whileStmt.body, scopeVarNames.slice(), capturedNames);
    } else if (stype === "do_while") {
      const doWhileStmt = stmt as DoWhileStatement;
      this.walkBlock(doWhileStmt.body, scopeVarNames.slice(), capturedNames);
      this.scanExprForCaptures(doWhileStmt.condition, scopeVarNames, capturedNames);
    } else if (stype === "for") {
      const forStmt = stmt as ForStatement;
      // init can declare a new loop variable; give it a fresh scope copy.
      const forScope = scopeVarNames.slice();
      if (forStmt.init !== null && forStmt.init !== undefined) {
        this.walkStatement(forStmt.init as Statement, forScope, capturedNames);
      }
      if (forStmt.condition !== null && forStmt.condition !== undefined) {
        this.scanExprForCaptures(forStmt.condition, forScope, capturedNames);
      }
      this.walkBlock(forStmt.body, forScope.slice(), capturedNames);
      if (forStmt.update !== null && forStmt.update !== undefined) {
        const upd = forStmt.update as { type: string };
        if (upd.type === "assignment") {
          this.walkStatement(forStmt.update as Statement, forScope, capturedNames);
        } else {
          this.scanExprForCaptures(forStmt.update as Expression, forScope, capturedNames);
        }
      }
    } else if (stype === "for_of") {
      const forOfStmt = stmt as ForOfStatement;
      this.scanExprForCaptures(forOfStmt.iterable, scopeVarNames, capturedNames);
      const forOfScope = scopeVarNames.slice();
      forOfScope.push(forOfStmt.variableName);
      if (forOfStmt.destructuredNames) {
        // Explicit cast to string[] avoids the union type (string[] | undefined)
        // that would confuse the native compiler's array index codegen.
        const dnames = forOfStmt.destructuredNames as string[];
        for (let dn = 0; dn < dnames.length; dn++) {
          forOfScope.push(dnames[dn]);
        }
      }
      this.walkBlock(forOfStmt.body, forOfScope, capturedNames);
    } else if (stype === "try") {
      const tryStmt = stmt as TryStatement;
      this.walkBlock(tryStmt.tryBlock, scopeVarNames.slice(), capturedNames);
      if (tryStmt.catchBody !== null && tryStmt.catchBody !== undefined) {
        const catchScope = scopeVarNames.slice();
        if (tryStmt.catchParam !== null && tryStmt.catchParam !== undefined) {
          catchScope.push(tryStmt.catchParam as string);
        }
        this.walkBlock(tryStmt.catchBody, catchScope, capturedNames);
      }
      if (tryStmt.finallyBlock !== null && tryStmt.finallyBlock !== undefined) {
        this.walkBlock(tryStmt.finallyBlock, scopeVarNames.slice(), capturedNames);
      }
    } else if (stype === "switch") {
      const switchStmt = stmt as SwitchStatement;
      this.scanExprForCaptures(switchStmt.discriminant, scopeVarNames, capturedNames);
      for (let ci = 0; ci < switchStmt.cases.length; ci++) {
        const c = switchStmt.cases[ci];
        if (c.test !== null && c.test !== undefined) {
          this.scanExprForCaptures(c.test as Expression, scopeVarNames, capturedNames);
        }
        this.walkStatements(c.consequent, scopeVarNames.slice(), capturedNames);
      }
    } else if (stype === "return") {
      const retStmt = stmt as ReturnStatement;
      if (retStmt.value !== null && retStmt.value !== undefined) {
        this.scanExprForCaptures(retStmt.value as Expression, scopeVarNames, capturedNames);
      }
    } else if (stype === "throw") {
      const throwStmt = stmt as ThrowStatement;
      this.scanExprForCaptures(throwStmt.argument, scopeVarNames, capturedNames);
    } else if (stype === "block") {
      this.walkBlock(stmt as BlockStatement, scopeVarNames.slice(), capturedNames);
    } else if (stype !== "break" && stype !== "continue") {
      // Expressions used as statements (call, method_call, new, await, etc.)
      this.scanExprForCaptures(stmt as Expression, scopeVarNames, capturedNames);
    }
  }

  // Walk an expression searching for arrow function literals. When one is found:
  //   1. Use ClosureAnalyzer to identify which outer-scope variables it captures.
  //   2. Add those names to capturedNames so subsequent mutations are caught.
  //   3. Recurse into the arrow body with a fresh scope (function boundary).
  private scanExprForCaptures(
    expr: Expression,
    scopeVarNames: string[],
    capturedNames: string[],
  ): void {
    const e = expr as { type: string };
    const etype = e.type;

    if (etype === "arrow_function") {
      const arrow = expr as ArrowFunctionNode;
      // Build a dummy-type parallel array — ClosureAnalyzer only uses names for
      // free-variable detection; llvmType in the result is unused here.
      const dummyTypes: string[] = [];
      for (let i = 0; i < scopeVarNames.length; i++) {
        dummyTypes.push("double");
      }
      const info = this.analyzer.analyze(
        arrow.params,
        arrow.body,
        scopeVarNames,
        dummyTypes,
        "check",
      );
      for (let i = 0; i < info.captures.length; i++) {
        // Explicit cast required — ObjectArray elements are i8* in native code; without
        // the cast the native compiler can't GEP to the correct field offset for .name.
        const cap = info.captures[i] as { name: string; llvmType: string };
        const capName = cap.name;
        if (capturedNames.indexOf(capName) === -1) {
          capturedNames.push(capName);
        }
      }
      // Recurse into the arrow body as a new function scope.
      const arrowBodyTyped = arrow.body as { type: string };
      if (arrowBodyTyped.type === "block") {
        this.walkBlock(arrow.body as BlockStatement, arrow.params.slice(), []);
      }
    } else if (etype === "binary") {
      // BinaryNode: { type, op, left, right } — must include op to get correct GEP index for left/right
      const binExpr = expr as { type: string; op: string; left: Expression; right: Expression };
      this.scanExprForCaptures(binExpr.left, scopeVarNames, capturedNames);
      this.scanExprForCaptures(binExpr.right, scopeVarNames, capturedNames);
    } else if (etype === "unary") {
      // UnaryNode: { type, op, operand } — must include op to get correct GEP index for operand
      const unaryExpr = expr as { type: string; op: string; operand: Expression };
      this.scanExprForCaptures(unaryExpr.operand, scopeVarNames, capturedNames);
    } else if (etype === "call") {
      // CallNode: { type, name, args } — must include name to get correct GEP index for args
      const callExpr = expr as { type: string; name: string; args: Expression[] };
      for (let i = 0; i < callExpr.args.length; i++) {
        this.scanExprForCaptures(callExpr.args[i], scopeVarNames, capturedNames);
      }
    } else if (etype === "method_call") {
      // MethodCallNode: { type, object, method, args } — must include method to get correct GEP index for args
      const mcExpr = expr as {
        type: string;
        object: Expression;
        method: string;
        args: Expression[];
      };
      this.scanExprForCaptures(mcExpr.object, scopeVarNames, capturedNames);
      for (let i = 0; i < mcExpr.args.length; i++) {
        this.scanExprForCaptures(mcExpr.args[i], scopeVarNames, capturedNames);
      }
    } else if (etype === "member_access") {
      const maExpr = expr as { type: string; object: Expression };
      this.scanExprForCaptures(maExpr.object, scopeVarNames, capturedNames);
    } else if (etype === "index_access") {
      const iaExpr = expr as { type: string; object: Expression; index: Expression };
      this.scanExprForCaptures(iaExpr.object, scopeVarNames, capturedNames);
      this.scanExprForCaptures(iaExpr.index, scopeVarNames, capturedNames);
    } else if (etype === "array") {
      const arrExpr = expr as { type: string; elements: Expression[] };
      for (let i = 0; i < arrExpr.elements.length; i++) {
        this.scanExprForCaptures(arrExpr.elements[i], scopeVarNames, capturedNames);
      }
    } else if (etype === "object") {
      // ObjectProperty: { key: string; value: Expression } — must use named type so the
      // native compiler generates a 2-field struct for GEP; anonymous inline types produce
      // a 1-field struct and would read key instead of value.
      const objExpr = expr as { type: string; properties: ObjectProperty[] };
      for (let i = 0; i < objExpr.properties.length; i++) {
        const prop = objExpr.properties[i] as ObjectProperty;
        this.scanExprForCaptures(prop.value, scopeVarNames, capturedNames);
      }
    } else if (etype === "template_literal") {
      const tlExpr = expr as { type: string; parts: (string | Expression)[] };
      for (let i = 0; i < tlExpr.parts.length; i++) {
        const part = tlExpr.parts[i];
        // Raw string segments have no .type; Expression nodes do.
        const partTyped = part as { type: string };
        if (partTyped.type) {
          this.scanExprForCaptures(part as Expression, scopeVarNames, capturedNames);
        }
      }
    } else if (etype === "conditional") {
      const condExpr = expr as {
        type: string;
        condition: Expression;
        consequent: Expression;
        alternate: Expression;
      };
      this.scanExprForCaptures(condExpr.condition, scopeVarNames, capturedNames);
      this.scanExprForCaptures(condExpr.consequent, scopeVarNames, capturedNames);
      this.scanExprForCaptures(condExpr.alternate, scopeVarNames, capturedNames);
    } else if (etype === "await") {
      const awaitExpr = expr as { type: string; argument: Expression };
      this.scanExprForCaptures(awaitExpr.argument, scopeVarNames, capturedNames);
    } else if (etype === "new") {
      // NewNode: { type, className, args } — must include className to get correct GEP index for args
      const newExpr = expr as { type: string; className: string; args: Expression[] };
      for (let i = 0; i < newExpr.args.length; i++) {
        this.scanExprForCaptures(newExpr.args[i], scopeVarNames, capturedNames);
      }
    } else if (etype === "type_assertion") {
      const taExpr = expr as { type: string; expression: Expression };
      this.scanExprForCaptures(taExpr.expression, scopeVarNames, capturedNames);
    } else if (etype === "spread_element") {
      const seExpr = expr as { type: string; argument: Expression };
      this.scanExprForCaptures(seExpr.argument, scopeVarNames, capturedNames);
    } else if (etype === "member_access_assignment") {
      // MemberAccessAssignmentNode: { type, object, property, value } — must include property for correct GEP index
      const maaExpr = expr as {
        type: string;
        object: Expression;
        property: string;
        value: Expression;
      };
      this.scanExprForCaptures(maaExpr.object, scopeVarNames, capturedNames);
      this.scanExprForCaptures(maaExpr.value, scopeVarNames, capturedNames);
    } else if (etype === "index_access_assignment") {
      const iaaExpr = expr as {
        type: string;
        object: Expression;
        index: Expression;
        value: Expression;
      };
      this.scanExprForCaptures(iaaExpr.object, scopeVarNames, capturedNames);
      this.scanExprForCaptures(iaaExpr.index, scopeVarNames, capturedNames);
      this.scanExprForCaptures(iaaExpr.value, scopeVarNames, capturedNames);
    } else if (etype === "map") {
      // Same issue as object: must use named MapEntry type for correct 2-field GEP.
      const mapExpr = expr as { type: string; entries: MapEntry[] };
      for (let i = 0; i < mapExpr.entries.length; i++) {
        const entry = mapExpr.entries[i] as MapEntry;
        this.scanExprForCaptures(entry.key, scopeVarNames, capturedNames);
        this.scanExprForCaptures(entry.value, scopeVarNames, capturedNames);
      }
    } else if (etype === "set") {
      const setExpr = expr as { type: string; values: Expression[] };
      for (let i = 0; i < setExpr.values.length; i++) {
        this.scanExprForCaptures(setExpr.values[i], scopeVarNames, capturedNames);
      }
    }
    // Leaves: variable, number, string, boolean, null, undefined, regex, this, super — no sub-expressions.
  }

  private reportError(varName: string, loc?: SourceLocation): void {
    let msg = "";
    if (loc !== null && loc !== undefined) {
      const file = loc.file || "<input>";
      msg +=
        file +
        ":" +
        loc.line +
        ":" +
        (loc.column + 1) +
        ": error: variable '" +
        varName +
        "' is captured by a closure but reassigned after capture\n";
    } else {
      msg +=
        "error: variable '" + varName + "' is captured by a closure but reassigned after capture\n";
    }
    msg += "  note: ChadScript closures capture by value; the closure will not see this change\n";
    console.error(msg);
    process.exit(1);
  }
}
