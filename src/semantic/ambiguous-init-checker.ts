import type {
  AST,
  Statement,
  BlockStatement,
  VariableDeclaration,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  SwitchCase,
  ArrayNode,
  VariableNode,
  SourceLocation,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

export function checkAmbiguousInits(ast: AST, sourceCode: string): void {
  const checker = new AmbiguousInitChecker(sourceCode);
  checker.check(ast);
}

class AmbiguousInitChecker {
  private sourceCode: string;

  constructor(sourceCode: string) {
    this.sourceCode = sourceCode;
  }

  check(ast: AST): void {
    const items = ast.topLevelItems;
    if (items && items.length > 0) {
      this.walkStatements(items as Statement[]);
    }

    for (let i = 0; i < ast.functions.length; i++) {
      this.walkBlock(ast.functions[i].body);
    }

    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        this.walkBlock(cls.methods[j].body);
      }
    }
  }

  private walkBlock(block: BlockStatement): void {
    this.walkStatements(block.statements);
  }

  private walkStatements(stmts: Statement[]): void {
    for (let i = 0; i < stmts.length; i++) {
      this.walkStatement(stmts[i]);
    }
  }

  private walkStatement(stmt: Statement): void {
    const s = stmt as { type: string };
    const t = s.type;

    if (t === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      this.checkDecl(decl);
    } else if (t === "if") {
      const ifStmt = stmt as IfStatement;
      this.walkBlock(ifStmt.thenBlock);
      if (ifStmt.elseBlock !== null && ifStmt.elseBlock !== undefined) {
        this.walkBlock(ifStmt.elseBlock);
      }
    } else if (t === "while") {
      this.walkBlock((stmt as WhileStatement).body);
    } else if (t === "do_while") {
      this.walkBlock((stmt as DoWhileStatement).body);
    } else if (t === "for") {
      const forStmt = stmt as ForStatement;
      if (forStmt.init !== null && forStmt.init !== undefined) {
        const init = forStmt.init as { type: string };
        if (init.type === "variable_declaration") {
          this.checkDecl(forStmt.init as VariableDeclaration);
        }
      }
      this.walkBlock(forStmt.body);
    } else if (t === "for_of") {
      this.walkBlock((stmt as ForOfStatement).body);
    } else if (t === "try") {
      const tryStmt = stmt as TryStatement;
      this.walkBlock(tryStmt.tryBlock);
      if (tryStmt.catchBody !== null && tryStmt.catchBody !== undefined) {
        this.walkBlock(tryStmt.catchBody);
      }
      if (tryStmt.finallyBlock !== null && tryStmt.finallyBlock !== undefined) {
        this.walkBlock(tryStmt.finallyBlock);
      }
    } else if (t === "switch") {
      const sw = stmt as SwitchStatement;
      for (let i = 0; i < sw.cases.length; i++) {
        const c = sw.cases[i] as SwitchCase;
        this.walkStatements(c.consequent);
      }
    }
  }

  private checkDecl(decl: VariableDeclaration): void {
    if (decl.declaredType !== null && decl.declaredType !== undefined) return;
    if (decl.value === null || decl.value === undefined) return;

    const vtype = (decl.value as { type: string }).type;

    if (vtype === "array") {
      const arr = decl.value as ArrayNode;
      if (arr.elements.length === 0) {
        this.report(
          "let " + decl.name + " = []",
          "empty array literal has unknown element type",
          "let " + decl.name + ": T[] = []",
          decl.loc,
        );
      }
    } else if (vtype === "null") {
      this.report(
        "let " + decl.name + " = null",
        "'null' has no type to infer from",
        "let " + decl.name + ": T | null = null",
        decl.loc,
      );
    } else if (vtype === "undefined") {
      this.report(
        "let " + decl.name + " = undefined",
        "'undefined' has no type to infer from",
        "let " + decl.name + ": T | undefined = undefined",
        decl.loc,
      );
    } else if (vtype === "variable") {
      // native parser represents null/undefined literals as variable nodes
      const varName = (decl.value as VariableNode).name;
      if (varName === "null") {
        this.report(
          "let " + decl.name + " = null",
          "'null' has no type to infer from",
          "let " + decl.name + ": T | null = null",
          decl.loc,
        );
      } else if (varName === "undefined") {
        this.report(
          "let " + decl.name + " = undefined",
          "'undefined' has no type to infer from",
          "let " + decl.name + ": T | undefined = undefined",
          decl.loc,
        );
      }
    }
  }

  private report(
    pattern: string,
    reason: string,
    fix: string,
    loc: SourceLocation | undefined,
  ): void {
    const output = formatCompileError(
      this.sourceCode,
      "ambiguous initializer: '" + pattern + "' — " + reason,
      loc,
      "add a type annotation",
      ["'" + fix + "'"],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}
