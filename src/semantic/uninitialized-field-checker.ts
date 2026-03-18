import type {
  AST,
  ClassNode,
  ClassMethod,
  ClassField,
  Statement,
  AssignmentStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  MemberAccessAssignmentNode,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

export function checkUninitializedFields(ast: AST, sourceCode: string): void {
  const checker = new UninitializedFieldChecker(sourceCode);
  checker.check(ast);
}

class UninitializedFieldChecker {
  private sourceCode: string;

  constructor(sourceCode: string) {
    this.sourceCode = sourceCode;
  }

  check(ast: AST): void {
    for (let i = 0; i < ast.classes.length; i++) {
      this.checkClass(ast.classes[i]);
    }
  }

  private checkClass(cls: ClassNode): void {
    if (cls.fields.length === 0) return;

    const uninitializedFields: ClassField[] = [];
    for (let i = 0; i < cls.fields.length; i++) {
      const field = cls.fields[i];
      if (field.isStatic) continue;
      if (field.initializer) continue;
      if (field.tsType) continue;
      if (field.fieldType !== "string" && field.fieldType !== "double") continue;
      uninitializedFields.push(field);
    }
    if (uninitializedFields.length === 0) return;

    const assignedNames: string[] = [];

    const constructor = this.findConstructor(cls);

    const paramPropNames: string[] = [];
    if (constructor) {
      this.walkStatements(constructor.body.statements, assignedNames);
      if (constructor.parameterProperties) {
        for (let i = 0; i < constructor.parameterProperties.length; i++) {
          paramPropNames.push(constructor.parameterProperties[i]);
        }
      }
    }

    for (let i = 0; i < cls.methods.length; i++) {
      if (!cls.methods[i].isConstructor) {
        this.walkStatements(cls.methods[i].body.statements, assignedNames);
      }
    }

    const stillUninitialized: ClassField[] = [];
    for (let i = 0; i < uninitializedFields.length; i++) {
      const field = uninitializedFields[i];
      if (this.arrayContains(assignedNames, field.name)) continue;
      if (this.arrayContains(paramPropNames, field.name)) continue;
      stillUninitialized.push(field);
    }

    if (stillUninitialized.length > 0) {
      this.emitErrors(cls, stillUninitialized);
    }
  }

  private arrayContains(arr: string[], name: string): boolean {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === name) return true;
    }
    return false;
  }

  private findConstructor(cls: ClassNode): ClassMethod | null {
    for (let i = 0; i < cls.methods.length; i++) {
      if (cls.methods[i].isConstructor) return cls.methods[i];
    }
    return null;
  }

  private walkStatements(stmts: Statement[], assigned: string[]): void {
    for (let i = 0; i < stmts.length; i++) {
      this.walkStatement(stmts[i], assigned);
    }
  }

  private walkStatement(stmt: Statement, assigned: string[]): void {
    if (!stmt) return;
    const s = stmt as { type: string };

    if (s.type === "assignment") {
      const assign = stmt as AssignmentStatement;
      if (assign.name && assign.name.startsWith("__member_access__")) {
        const maNode = assign.value as MemberAccessAssignmentNode;
        if (
          maNode &&
          maNode.type === "member_access_assignment" &&
          maNode.object &&
          (maNode.object as { type: string }).type === "this"
        ) {
          assigned.push(maNode.property);
        }
      }
    } else if (s.type === "if") {
      const ifStmt = stmt as IfStatement;
      const thenAssigned: string[] = [];
      this.walkStatements(ifStmt.thenBlock.statements, thenAssigned);
      if (ifStmt.elseBlock) {
        const elseAssigned: string[] = [];
        this.walkStatements(ifStmt.elseBlock.statements, elseAssigned);
        for (let j = 0; j < thenAssigned.length; j++) {
          if (this.arrayContains(elseAssigned, thenAssigned[j])) {
            assigned.push(thenAssigned[j]);
          }
        }
      }
    } else if (s.type === "while") {
      const w = stmt as WhileStatement;
      this.walkStatements(w.body.statements, assigned);
    } else if (s.type === "do_while") {
      const dw = stmt as DoWhileStatement;
      this.walkStatements(dw.body.statements, assigned);
    } else if (s.type === "for") {
      const f = stmt as ForStatement;
      this.walkStatements(f.body.statements, assigned);
    } else if (s.type === "for_of") {
      const fo = stmt as ForOfStatement;
      this.walkStatements(fo.body.statements, assigned);
    } else if (s.type === "try") {
      const t = stmt as TryStatement;
      this.walkStatements(t.tryBlock.statements, assigned);
      if (t.catchBody) this.walkStatements(t.catchBody.statements, assigned);
      if (t.finallyBlock) this.walkStatements(t.finallyBlock.statements, assigned);
    } else if (s.type === "switch") {
      const sw = stmt as SwitchStatement;
      for (let i = 0; i < sw.cases.length; i++) {
        this.walkStatements(sw.cases[i].consequent, assigned);
      }
    }
  }

  private findFieldLoc(
    cls: ClassNode,
    fieldName: string,
  ): { line: number; column: number; file: string } | null {
    if (!cls.loc || !this.sourceCode) return null;
    const lines = this.sourceCode.split("\n");
    const startLine = cls.loc.line - 1;
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      const idx = line.indexOf(fieldName);
      if (idx !== -1) {
        const before = line.substring(0, idx).trim();
        const after = line.substring(idx + fieldName.length).trimStart();
        if (
          (before === "" ||
            before === "public" ||
            before === "private" ||
            before === "protected" ||
            before === "readonly") &&
          (after.startsWith(":") || after.startsWith(";"))
        ) {
          return { line: i + 1, column: idx + 1, file: cls.loc.file || "<unknown>" };
        }
      }
    }
    return null;
  }

  private emitErrors(cls: ClassNode, fields: ClassField[]): void {
    let output = "";
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const fieldLoc = this.findFieldLoc(cls, field.name);
      const loc = fieldLoc
        ? { file: fieldLoc.file, line: fieldLoc.line, column: fieldLoc.column, offset: 0 }
        : cls.loc;
      output += formatCompileError(
        this.sourceCode,
        "class '" + cls.name + "' has uninitialized field '" + field.name + "'",
        loc,
        "assign a value in the field declaration or constructor",
      );
    }
    process.stderr.write(output);
    process.exit(1);
  }
}
