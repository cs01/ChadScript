// Type assertion field-order checker — semantic pass run before IR generation.
// Inline type assertions like (expr as { type: string; left: Expr; right: Expr }) use their listed
// field positions as GEP indices in native code. If those fields are not a prefix of the real
// interface in the correct order, the GEP reads wrong memory → segfault.
//
// This pass finds all inline { } type assertions with 2+ fields, looks for declared interfaces
// that contain all those field names, and errors if none of those interfaces accept the assertion
// as a valid consecutive prefix (in-order, no gaps).

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
  SwitchCase,
  ReturnStatement,
  ThrowStatement,
  ArrowFunctionNode,
  TypeAssertionNode,
  InterfaceDeclaration,
  InterfaceField,
  ObjectProperty,
  MapEntry,
  MethodCallNode,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

export function checkTypeAssertions(ast: AST, sourceCode: string): void {
  const checker = new TypeAssertionChecker(ast, sourceCode);
  checker.check();
}

class TypeAssertionChecker {
  private ast: AST;
  private sourceCode: string;

  constructor(ast: AST, sourceCode: string) {
    this.ast = ast;
    this.sourceCode = sourceCode;
  }

  check(): void {
    if (this.ast.topLevelItems && this.ast.topLevelItems.length > 0) {
      this.walkStatements(this.ast.topLevelItems as Statement[]);
    }
    for (let i = 0; i < this.ast.functions.length; i++) {
      this.walkBlock(this.ast.functions[i].body);
    }
    for (let i = 0; i < this.ast.classes.length; i++) {
      const cls = this.ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        this.walkBlock(cls.methods[j].body);
      }
    }
  }

  private walkStatements(stmts: Statement[]): void {
    for (let i = 0; i < stmts.length; i++) {
      this.walkStatement(stmts[i]);
    }
  }

  private walkBlock(block: BlockStatement): void {
    this.walkStatements(block.statements);
  }

  private walkStatement(stmt: Statement): void {
    const s = stmt as { type: string };
    const stype = s.type;
    if (stype === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      if (decl.value) this.checkExpr(decl.value as Expression);
    } else if (stype === "assignment") {
      const asgn = stmt as AssignmentStatement;
      this.checkExpr(asgn.value);
    } else if (stype === "if") {
      const ifStmt = stmt as IfStatement;
      this.checkExpr(ifStmt.condition);
      this.walkBlock(ifStmt.thenBlock);
      if (ifStmt.elseBlock) this.walkBlock(ifStmt.elseBlock);
    } else if (stype === "while") {
      const whileStmt = stmt as WhileStatement;
      this.checkExpr(whileStmt.condition);
      this.walkBlock(whileStmt.body);
    } else if (stype === "do_while") {
      const doWhile = stmt as DoWhileStatement;
      this.walkBlock(doWhile.body);
      this.checkExpr(doWhile.condition);
    } else if (stype === "for") {
      const forStmt = stmt as ForStatement;
      if (forStmt.init) this.walkStatement(forStmt.init as Statement);
      if (forStmt.condition) this.checkExpr(forStmt.condition as Expression);
      this.walkBlock(forStmt.body);
      if (forStmt.update) this.checkExpr(forStmt.update as Expression);
    } else if (stype === "for_of") {
      const forOf = stmt as ForOfStatement;
      this.checkExpr(forOf.iterable);
      this.walkBlock(forOf.body);
    } else if (stype === "try") {
      const tryStmt = stmt as TryStatement;
      this.walkBlock(tryStmt.tryBlock);
      if (tryStmt.catchBody) this.walkBlock(tryStmt.catchBody);
      if (tryStmt.finallyBlock) this.walkBlock(tryStmt.finallyBlock);
    } else if (stype === "switch") {
      const switchStmt = stmt as SwitchStatement;
      this.checkExpr(switchStmt.discriminant);
      for (let i = 0; i < switchStmt.cases.length; i++) {
        const c = switchStmt.cases[i] as SwitchCase;
        if (c.test) this.checkExpr(c.test as Expression);
        this.walkStatements(c.consequent);
      }
    } else if (stype === "return") {
      const retStmt = stmt as ReturnStatement;
      if (retStmt.value) this.checkExpr(retStmt.value as Expression);
    } else if (stype === "throw") {
      const throwStmt = stmt as ThrowStatement;
      this.checkExpr(throwStmt.argument);
    } else if (stype === "block") {
      this.walkBlock(stmt as BlockStatement);
    } else if (stype !== "break" && stype !== "continue") {
      this.checkExpr(stmt as Expression);
    }
  }

  private checkExpr(expr: Expression): void {
    const e = expr as { type: string };
    const etype = e.type;
    if (etype === "type_assertion") {
      const ta = expr as TypeAssertionNode;
      this.validateInlineAssertion(ta);
      this.validateNamedAssertion(ta);
      this.checkExpr(ta.expression);
    } else if (etype === "binary") {
      // BinaryNode: { type, op, left, right }
      const bin = expr as { type: string; op: string; left: Expression; right: Expression };
      this.checkExpr(bin.left);
      this.checkExpr(bin.right);
    } else if (etype === "unary") {
      // UnaryNode: { type, op, operand }
      const unary = expr as { type: string; op: string; operand: Expression };
      this.checkExpr(unary.operand);
    } else if (etype === "call") {
      // CallNode: { type, name, args }
      const call = expr as { type: string; name: string; args: Expression[] };
      for (let i = 0; i < call.args.length; i++) {
        this.checkExpr(call.args[i]);
      }
    } else if (etype === "method_call") {
      const mc = expr as MethodCallNode;
      this.checkExpr(mc.object);
      for (let i = 0; i < mc.args.length; i++) {
        this.checkExpr(mc.args[i]);
      }
    } else if (etype === "member_access") {
      const ma = expr as { type: string; object: Expression };
      this.checkExpr(ma.object);
    } else if (etype === "index_access") {
      // IndexAccessNode: { type, object, index }
      const ia = expr as { type: string; object: Expression; index: Expression };
      this.checkExpr(ia.object);
      this.checkExpr(ia.index);
    } else if (etype === "array") {
      const arr = expr as { type: string; elements: Expression[] };
      for (let i = 0; i < arr.elements.length; i++) {
        this.checkExpr(arr.elements[i]);
      }
    } else if (etype === "object") {
      const obj = expr as { type: string; properties: ObjectProperty[] };
      for (let i = 0; i < obj.properties.length; i++) {
        const prop = obj.properties[i] as ObjectProperty;
        this.checkExpr(prop.value);
      }
    } else if (etype === "conditional") {
      const cond = expr as {
        type: string;
        condition: Expression;
        consequent: Expression;
        alternate: Expression;
      };
      this.checkExpr(cond.condition);
      this.checkExpr(cond.consequent);
      this.checkExpr(cond.alternate);
    } else if (etype === "await") {
      const aw = expr as { type: string; argument: Expression };
      this.checkExpr(aw.argument);
    } else if (etype === "new") {
      // NewNode: { type, className, args }
      const newExpr = expr as { type: string; className: string; args: Expression[] };
      for (let i = 0; i < newExpr.args.length; i++) {
        this.checkExpr(newExpr.args[i]);
      }
    } else if (etype === "arrow_function") {
      const arrow = expr as ArrowFunctionNode;
      const bodyTyped = arrow.body as { type: string };
      if (bodyTyped.type === "block") {
        this.walkBlock(arrow.body as BlockStatement);
      } else {
        this.checkExpr(arrow.body as Expression);
      }
    } else if (etype === "template_literal") {
      const tl = expr as { type: string; parts: (string | Expression)[] };
      for (let i = 0; i < tl.parts.length; i++) {
        const part = tl.parts[i];
        const partTyped = part as { type: string };
        if (partTyped.type) {
          this.checkExpr(part as Expression);
        }
      }
    } else if (etype === "spread_element") {
      const se = expr as { type: string; argument: Expression };
      this.checkExpr(se.argument);
    } else if (etype === "member_access_assignment") {
      // MemberAccessAssignmentNode: { type, object, property, value }
      const maa = expr as {
        type: string;
        object: Expression;
        property: string;
        value: Expression;
      };
      this.checkExpr(maa.object);
      this.checkExpr(maa.value);
    } else if (etype === "index_access_assignment") {
      // IndexAccessAssignmentNode: { type, object, index, value }
      const iaa = expr as {
        type: string;
        object: Expression;
        index: Expression;
        value: Expression;
      };
      this.checkExpr(iaa.object);
      this.checkExpr(iaa.index);
      this.checkExpr(iaa.value);
    } else if (etype === "map") {
      const mapExpr = expr as { type: string; entries: MapEntry[] };
      for (let i = 0; i < mapExpr.entries.length; i++) {
        const entry = mapExpr.entries[i] as MapEntry;
        this.checkExpr(entry.key);
        this.checkExpr(entry.value);
      }
    } else if (etype === "set") {
      const setExpr = expr as { type: string; values: Expression[] };
      for (let i = 0; i < setExpr.values.length; i++) {
        this.checkExpr(setExpr.values[i]);
      }
    }
  }

  private checkOpaqueSource(ta: TypeAssertionNode, fields: InterfaceField[]): void {
    const inner = ta.expression as { type: string };
    if (inner.type !== "type_assertion") return;
    const innerTa = ta.expression as TypeAssertionNode;
    const src = innerTa.assertedType;
    if (src !== "unknown" && src !== "any" && src !== "object") return;

    const fieldNames: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      fieldNames.push(this.stripOpt((fields[i] as InterfaceField).name));
    }

    const output = formatCompileError(
      this.sourceCode,
      "inline type assertion 'as { " +
        fieldNames.join("; ") +
        " }' on opaque source (via 'as " +
        src +
        "') produces wrong GEP indices at runtime",
      ta.loc,
      "use 'as NamedInterface' instead of inline '{ ... }' when casting from '" + src + "'",
      [
        "inline assertion field positions become GEP indices in native code",
        "opaque sources have no source interface for the prefix checker to verify against",
        "declare a named interface with the correct field layout and cast to that",
      ],
    );
    process.stderr.write(output);
    process.exit(1);
  }

  private validateInlineAssertion(ta: TypeAssertionNode): void {
    const assertedType = ta.assertedType;
    if (!assertedType.startsWith("{")) return;

    const parsedFields = this.parseInlineFields(assertedType);
    if (parsedFields.length < 2) return;

    this.checkOpaqueSource(ta, parsedFields);

    const assertedNames: string[] = [];
    for (let i = 0; i < parsedFields.length; i++) {
      const pf = parsedFields[i] as InterfaceField;
      assertedNames.push(this.stripOpt(pf.name));
    }

    if (!this.ast.interfaces) return;

    let anyMatchingInterface = false;
    let anyValidPrefix = false;
    let bestMatchIface: InterfaceDeclaration | null = null;
    let bestMatchFields: InterfaceField[] | null = null;
    let bestMatchReason: string | null = null;

    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const iface = this.ast.interfaces[i] as InterfaceDeclaration;
      const allFields = this.getAllFields(iface);

      const indices: number[] = [];
      let allFound = true;
      for (let j = 0; j < assertedNames.length; j++) {
        let idx: number = -1;
        for (let k = 0; k < allFields.length; k++) {
          const f = allFields[k] as InterfaceField;
          if (this.stripOpt(f.name) === assertedNames[j]) {
            idx = k;
            break;
          }
        }
        if (idx === -1) {
          allFound = false;
          break;
        }
        indices.push(idx);
      }
      if (!allFound) continue;

      anyMatchingInterface = true;

      let orderOk = true;
      for (let j = 1; j < indices.length; j++) {
        if (indices[j] <= indices[j - 1]) {
          orderOk = false;
          break;
        }
      }
      if (!orderOk) {
        if (bestMatchIface === null) {
          bestMatchIface = iface;
          bestMatchFields = allFields;
          bestMatchReason = "fields are out of order relative to '" + iface.name + "'";
        }
        continue;
      }

      const maxIdx = indices[indices.length - 1];
      let missingField: string | null = null;
      for (let k = 0; k < maxIdx; k++) {
        const f = allFields[k] as InterfaceField;
        const fname = this.stripOpt(f.name);
        if (assertedNames.indexOf(fname) === -1) {
          missingField = fname;
          break;
        }
      }
      if (missingField !== null) {
        if (bestMatchIface === null) {
          bestMatchIface = iface;
          bestMatchFields = allFields;
          bestMatchReason =
            "field '" +
            missingField +
            "' from '" +
            iface.name +
            "' is skipped before the last listed field";
        }
        continue;
      }

      anyValidPrefix = true;
      break;
    }

    if (anyMatchingInterface && !anyValidPrefix && bestMatchIface !== null) {
      this.reportError(ta, bestMatchIface, bestMatchFields!, assertedNames, bestMatchReason!);
    }
  }

  private validateNamedAssertion(ta: TypeAssertionNode): void {
    const assertedType = ta.assertedType;
    if (assertedType.startsWith("{")) return;

    const innerBase = ta.expression as { type: string };
    if (innerBase.type === "type_assertion") {
      const inner = ta.expression as TypeAssertionNode;
      if (inner.assertedType === "unknown" || inner.assertedType === "any") return;
    }

    const tiface = this.getInterface(assertedType);
    if (!tiface) return;

    const tFields = this.getAllFields(tiface);
    const reqNames: string[] = [];
    for (let i = 0; i < tFields.length; i++) {
      const f = tFields[i] as InterfaceField;
      if (!f.name.endsWith("?")) reqNames.push(this.stripOpt(f.name));
    }
    if (reqNames.length < 2) return;
    if (reqNames[0] === "type") return;
    if (!this.ast.interfaces) return;

    let anyValid = false;
    let anyMismatch = false;
    let mismatchIfaceName = "";
    let mismatchReason = "";

    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const uIface = this.ast.interfaces[i] as InterfaceDeclaration;
      if (uIface.name === assertedType) continue;

      const uFields = this.getAllFields(uIface);

      // Build parallel index arrays: tIndices[j] = T-GEP-index, uIndices[j] = U-GEP-index
      // for the j-th required (non-optional) T-field. Both are pushed as doubles (number[]).
      const tIndices: number[] = [];
      const uIndices: number[] = [];
      let allFound = true;
      for (let ti = 0; ti < tFields.length; ti++) {
        const tf = tFields[ti] as InterfaceField;
        if (tf.name.endsWith("?")) continue;
        const reqName = this.stripOpt(tf.name);
        let uIdx: number = -1;
        for (let k = 0; k < uFields.length; k++) {
          if (this.stripOpt((uFields[k] as InterfaceField).name) === reqName) {
            uIdx = k;
            break;
          }
        }
        if (uIdx === -1) {
          allFound = false;
          break;
        }
        tIndices.push(ti);
        uIndices.push(uIdx);
      }
      if (!allFound) continue;
      if (tIndices.length < 2) continue;

      // Check T-GEP-index === U-GEP-index for each required field (both arrays are double[]).
      let orderOk = true;
      let badReason = "";
      for (let j = 0; j < tIndices.length; j++) {
        if (tIndices[j] !== uIndices[j]) {
          orderOk = false;
          const diff = uIndices[j] - tIndices[j];
          if (diff > 1 || diff < -1) {
            badReason =
              "field '" +
              reqNames[j] +
              "' is at index " +
              tIndices[j] +
              " in '" +
              assertedType +
              "' but index " +
              uIndices[j] +
              " in '" +
              uIface.name +
              "'";
          }
          break;
        }
      }

      if (orderOk) {
        anyValid = true;
        break;
      } else if (!anyMismatch && badReason !== "") {
        anyMismatch = true;
        mismatchIfaceName = uIface.name;
        mismatchReason = badReason;
      }
    }

    if (anyMismatch && !anyValid) {
      const tNames: string[] = [];
      for (let i = 0; i < tFields.length; i++) {
        tNames.push(this.stripOpt((tFields[i] as InterfaceField).name));
      }
      const notes: string[] = [];
      notes.push("asserted type '" + assertedType + "': { " + tNames.join("; ") + " }");
      const mismatchIface = this.getInterface(mismatchIfaceName);
      if (mismatchIface !== null) {
        const uF = this.getAllFields(mismatchIface);
        const uNames: string[] = [];
        for (let i = 0; i < uF.length; i++) {
          uNames.push((uF[i] as InterfaceField).name);
        }
        notes.push("interface '" + mismatchIfaceName + "': { " + uNames.join("; ") + " }");
      }
      notes.push(
        "GEP indices in native code are determined by field position in the asserted type",
      );
      const output = formatCompileError(
        this.sourceCode,
        "named type assertion '" +
          assertedType +
          "' has wrong field indices relative to '" +
          mismatchIfaceName +
          "': " +
          mismatchReason,
        ta.loc,
        "'" +
          assertedType +
          "' fields must appear at the same positions as in '" +
          mismatchIfaceName +
          "'",
        notes,
      );
      process.stderr.write(output);
      process.exit(1);
    }
  }

  private getAllFields(iface: InterfaceDeclaration): InterfaceField[] {
    const result: InterfaceField[] = [];
    if (iface.extends && iface.extends.length > 0) {
      for (let i = 0; i < iface.extends.length; i++) {
        const parentName = iface.extends[i];
        const parent = this.getInterface(parentName);
        if (parent) {
          const parentFields = this.getAllFields(parent);
          for (let j = 0; j < parentFields.length; j++) {
            result.push(parentFields[j]);
          }
        }
      }
    }
    for (let i = 0; i < iface.fields.length; i++) {
      result.push(iface.fields[i]);
    }
    return result;
  }

  private getInterface(name: string): InterfaceDeclaration | null {
    if (!this.ast.interfaces) return null;
    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const iface = this.ast.interfaces[i] as InterfaceDeclaration;
      if (iface.name === name) return iface;
    }
    return null;
  }

  private reportError(
    ta: TypeAssertionNode,
    iface: InterfaceDeclaration,
    ifaceFields: InterfaceField[],
    assertedNames: string[],
    reason: string,
  ): void {
    const ifaceFieldNames: string[] = [];
    for (let i = 0; i < ifaceFields.length; i++) {
      ifaceFieldNames.push((ifaceFields[i] as InterfaceField).name);
    }
    const output = formatCompileError(
      this.sourceCode,
      "inline type assertion fields do not form a valid prefix of '" + iface.name + "': " + reason,
      ta.loc,
      "use 'as " + iface.name + "' or list fields as a prefix in exact interface order",
      [
        "assertion: { " + assertedNames.join("; ") + " }",
        "interface: { " + ifaceFieldNames.join("; ") + " }",
        "inline assertion field positions define GEP indices in native code",
      ],
    );
    process.stderr.write(output);
    process.exit(1);
  }

  // Parse "{ name: type; name2: type2 }" into InterfaceField pairs. Handles nested generics.
  // Class method (not standalone) so the native compiler can track the InterfaceField[] return type.
  private parseInlineFields(typeStr: string): InterfaceField[] {
    if (!typeStr.startsWith("{") || !typeStr.endsWith("}")) return [];
    const inner = typeStr.slice(1, typeStr.length - 1).trim();
    if (!inner) return [];
    const fields: InterfaceField[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === "{" || ch === "(" || ch === "[" || ch === "<") {
        depth++;
      } else if (ch === "}" || ch === ")" || ch === "]" || ch === ">") {
        depth--;
      } else if (ch === ";" && depth === 0) {
        const part = inner.slice(start, i).trim();
        if (part) {
          const colonIdx = part.indexOf(":");
          if (colonIdx !== -1) {
            const field: InterfaceField = {
              name: part.slice(0, colonIdx).trim(),
              type: part.slice(colonIdx + 1).trim(),
            };
            fields.push(field);
          }
        }
        start = i + 1;
      }
    }
    const lastPart = inner.slice(start).trim();
    if (lastPart) {
      const colonIdx = lastPart.indexOf(":");
      if (colonIdx !== -1) {
        const field: InterfaceField = {
          name: lastPart.slice(0, colonIdx).trim(),
          type: lastPart.slice(colonIdx + 1).trim(),
        };
        fields.push(field);
      }
    }
    return fields;
  }

  private stripOpt(name: string): string {
    if (name.endsWith("?")) return name.slice(0, name.length - 1);
    return name;
  }
}
