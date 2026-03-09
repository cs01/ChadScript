// NOTE: This file uses raw ctx.emit() extensively. Prefer structured IR builders
// (emitStore, emitLoad, emitCall, etc.) when modifying — see .claude/rules.md.

import {
  Expression,
  Statement,
  BlockStatement,
  MemberAccessNode,
  VariableNode,
  BinaryNode,
  InterfaceDeclaration,
  ForOfStatement,
  MethodCallNode,
  InterfaceField,
  CommonField,
  FunctionParameter,
  SwitchStatement,
  SwitchCase,
  StringNode,
  TryStatement,
  WhileStatement,
  DoWhileStatement,
  AssignmentStatement,
  ThrowStatement,
  ArrayNode,
  ForStatement,
} from "../../ast/types.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";
import {
  SymbolKind,
  ObjectArrayMetadata,
  ObjectMetadata,
  createObjectMetadata,
  createObjectMetadataWithInterface,
} from "../infrastructure/symbol-table.js";
import type { UnionCommonFields } from "../infrastructure/type-resolver/index.js";
import type { FieldInfo } from "../infrastructure/type-resolver/types.js";
import { stripOptional } from "../infrastructure/type-system.js";

interface ExprBase {
  type: string;
}

// ============================================
// CONTROL FLOW GENERATOR - If/while/loops
// ============================================

export class ControlFlowGenerator {
  private loopContinueLabels: string[];
  private loopBreakLabels: string[];

  constructor(private ctx: IGeneratorContext) {
    this.loopContinueLabels = [];
    this.loopBreakLabels = [];
  }

  // Helper methods delegate to context
  private nextTemp(): string {
    return this.ctx.nextTemp();
  }
  private nextLabel(prefix: string): string {
    return this.ctx.nextLabel(prefix);
  }
  private emit(instruction: string): void {
    this.ctx.emit(instruction);
  }

  // Helper to convert a value to boolean (i1) for branching
  private convertToBool(value: string): string {
    // Check if value is a double or i32 based on variable types
    const valueType = this.ctx.getVariableType(value);

    if (valueType === "i1") {
      // Value is already a boolean (i1), use it directly
      return value;
    } else if (valueType === "double" || (value.indexOf(".") !== -1 && !value.startsWith("%"))) {
      // Value is a double, use fcmp
      const condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${value}, 0.0`);
      return condBool;
    } else if (valueType && valueType.indexOf("*") !== -1) {
      // Value is a pointer type, check if non-null
      // Use i8* for complex types that aren't valid LLVM types
      const isValidLlvmType =
        !valueType.startsWith("%{") && !valueType.includes("|") && !valueType.includes(":");
      const llvmType = isValidLlvmType ? valueType : "i8*";
      const condBool = this.ctx.emitIcmp("ne", llvmType, value, "null");
      return condBool;
    } else if (valueType === "i32") {
      // Value is i32, use icmp ne for integer comparison
      const condBool = this.ctx.emitIcmp("ne", "i32", value, "0");
      return condBool;
    } else if (valueType === "i64") {
      const condBool = this.ctx.emitIcmp("ne", "i64", value, "0");
      return condBool;
    } else {
      // Unknown type - assume double for temp registers
      if (value.startsWith("%")) {
        const condBool = this.nextTemp();
        this.emit(`${condBool} = fcmp one double ${value}, 0.0`);
        return condBool;
      }
      // Literal i32 value - convert to double then compare
      const condDouble = this.nextTemp();
      this.emit(`${condDouble} = sitofp i32 ${value} to double`);
      const condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${condDouble}, 0.0`);
      return condBool;
    }
  }

  private convertToNonNullish(value: string, valueType: string): string {
    if (
      valueType === "i1" ||
      valueType === "double" ||
      valueType === "i32" ||
      valueType === "i64"
    ) {
      const condBool = this.ctx.emitIcmp("eq", "i32", "1", "1");
      return condBool;
    }
    if (valueType && valueType.indexOf("*") !== -1) {
      const isValidLlvmType =
        !valueType.startsWith("%{") && !valueType.includes("|") && !valueType.includes(":");
      const llvmType = isValidLlvmType ? valueType : "i8*";
      const condBool = this.ctx.emitIcmp("ne", llvmType, value, "null");
      return condBool;
    }
    const condBool = this.ctx.emitIcmp("eq", "i32", "1", "1");
    return condBool;
  }

  generateIfStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "if") {
      throw new Error("Expected if statement");
    }

    const ifStmt = stmt as {
      type: string;
      condition: Expression;
      thenBlock: BlockStatement;
      elseBlock: BlockStatement | null;
    };

    const thenLabel = this.nextLabel("then");
    const elseLabel = this.nextLabel("else");
    const mergeLabel = this.nextLabel("merge");

    const typeGuard = this.detectTypeGuard(ifStmt.condition);

    const condValue = this.ctx.generateExpression(ifStmt.condition, params);
    const condBool = this.convertToBool(condValue);

    if (ifStmt.elseBlock) {
      this.ctx.emitBrCond(condBool, thenLabel, elseLabel);
    } else {
      this.ctx.emitBrCond(condBool, thenLabel, mergeLabel);
    }

    this.ctx.emitLabel(thenLabel);
    this.ctx.setCurrentLabel(thenLabel);

    if (typeGuard) {
      const tg = typeGuard as {
        varName: string;
        narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] };
      };
      this.ctx.symbolTable.narrowType(tg.varName, tg.narrowedMetadata);
    }

    this.ctx.generateBlock(ifStmt.thenBlock, params);

    if (typeGuard) {
      const tg = typeGuard as {
        varName: string;
        narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] };
      };
      this.ctx.symbolTable.restoreType(tg.varName);
    }

    const thenHasTerminator = this.ctx.lastInstructionIsTerminator();
    if (!thenHasTerminator) {
      this.ctx.emitBr(mergeLabel);
    }

    let elseHasTerminator = false;
    if (ifStmt.elseBlock) {
      this.ctx.emitLabel(elseLabel);
      this.ctx.setCurrentLabel(elseLabel);
      this.ctx.generateBlock(ifStmt.elseBlock, params);
      elseHasTerminator = this.ctx.lastInstructionIsTerminator();
      if (!elseHasTerminator) {
        this.ctx.emitBr(mergeLabel);
      }
    }

    if (ifStmt.elseBlock && thenHasTerminator && elseHasTerminator) {
      return "0";
    }

    // Merge point
    this.ctx.emitLabel(mergeLabel);
    this.ctx.setCurrentLabel(mergeLabel);

    return "0";
  }

  generateWhileStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "while") {
      throw new Error("Expected while statement");
    }

    const whileStmt = stmt as WhileStatement;

    // Generate unique labels
    const condLabel = this.nextLabel("while_cond");
    const bodyLabel = this.nextLabel("while_body");
    const endLabel = this.nextLabel("while_end");

    // Jump to condition check
    this.ctx.emitBr(condLabel);

    // Condition block
    this.ctx.emitLabel(condLabel);
    const condValue = this.ctx.generateExpression(whileStmt.condition, params);
    const condBool = this.convertToBool(condValue);
    this.ctx.emitBrCond(condBool, bodyLabel, endLabel);

    // Body block - push loop context for break/continue
    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);
    this.loopContinueLabels.push(condLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(whileStmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();
    const bodyHasTerminator = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator) {
      this.ctx.emitBr(condLabel);
    }

    // End block
    this.ctx.emitLabel(endLabel);

    return "0";
  }

  // do { body } while (condition) — body executes first, then condition is checked.
  // continue jumps to cond (matching JS semantics), break jumps to end.
  generateDoWhileStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "do_while") {
      throw new Error("Expected do_while statement");
    }

    const doWhileStmt = stmt as DoWhileStatement;

    const bodyLabel = this.nextLabel("dowhile_body");
    const condLabel = this.nextLabel("dowhile_cond");
    const endLabel = this.nextLabel("dowhile_end");

    // Jump directly to body (body always executes at least once)
    this.ctx.emitBr(bodyLabel);

    // Body block
    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);
    this.loopContinueLabels.push(condLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(doWhileStmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();
    const bodyHasTerminator2 = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator2) {
      this.ctx.emitBr(condLabel);
    }

    // Condition block — evaluated after body
    this.ctx.emitLabel(condLabel);
    this.ctx.setCurrentLabel(condLabel);
    const condValue = this.ctx.generateExpression(doWhileStmt.condition, params);
    const condBool = this.convertToBool(condValue);
    this.ctx.emitBrCond(condBool, bodyLabel, endLabel);

    // End block
    this.ctx.emitLabel(endLabel);

    return "0";
  }

  generateForStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "for") {
      throw new Error("Expected for statement");
    }

    const forStmt = stmt as {
      type: string;
      init: Statement | null;
      condition: Expression | null;
      update: Statement | null;
      body: BlockStatement;
    };

    // Generate init if present
    if (forStmt.init) {
      const initBase = forStmt.init as { type: string };
      if (initBase.type === "variable_declaration") {
        const initVarDecl = forStmt.init as {
          type: string;
          kind: string;
          name: string;
          value: Expression | null;
          declaredType?: string;
        };
        if (!initVarDecl.value) {
          throw new Error("Variable declaration in for loop must have an initializer");
        }
        const value = this.ctx.generateExpression(initVarDecl.value, params);
        const dblValue = this.ctx.ensureDouble(value);
        const allocaReg = this.ctx.nextAllocaReg(initVarDecl.name);
        this.ctx.defineVariable(initVarDecl.name, allocaReg, "double", SymbolKind.Number, "local");
        this.emit(`${allocaReg} = alloca double`);
        this.ctx.emitStore("double", dblValue, allocaReg);
      } else if (initBase.type === "assignment") {
        const initAssign = forStmt.init as AssignmentStatement;
        let value = this.ctx.generateExpression(initAssign.value, params);
        const allocaReg = this.ctx.getVariableAlloca(initAssign.name);
        if (!allocaReg) {
          throw new Error(`Variable ${initAssign.name} not found`);
        }
        const varType = this.ctx.getVariableType(initAssign.name) || "double";
        const valType = this.ctx.getVariableType(value);
        if (varType === "double" && valType === "i64") {
          value = this.ctx.ensureDouble(value);
        } else if (varType === "i64" && valType === "double") {
          value = this.ctx.ensureI64(value);
        }
        this.ctx.emitStore(varType, value, allocaReg);
      }
    }

    // Generate unique labels
    const condLabel = this.nextLabel("for_cond");
    const bodyLabel = this.nextLabel("for_body");
    const updateLabel = this.nextLabel("for_update");
    const endLabel = this.nextLabel("for_end");

    // Jump to condition check
    this.ctx.emitBr(condLabel);

    // Condition block
    this.ctx.emitLabel(condLabel);
    if (forStmt.condition) {
      const condValue = this.ctx.generateExpression(forStmt.condition, params);
      const condBool = this.convertToBool(condValue);
      this.ctx.emitBrCond(condBool, bodyLabel, endLabel);
    } else {
      // No condition means infinite loop
      this.ctx.emitBr(bodyLabel);
    }

    // Body block - push loop context for break/continue
    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);
    this.loopContinueLabels.push(updateLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(forStmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();
    // Check if the LAST instruction is a terminator
    const bodyHasTerminator3 = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator3) {
      this.ctx.emitBr(updateLabel);
    }

    // Update block
    this.ctx.emitLabel(updateLabel);
    if (forStmt.update) {
      const updateTyped = forStmt.update as AssignmentStatement;
      const updateType = updateTyped.type;
      if (updateType === "assignment") {
        const updateName = updateTyped.name;
        if (!updateName) {
          throw new Error("Assignment update has no name");
        }
        let value = this.ctx.generateExpression(updateTyped.value, params);
        const allocaReg = this.ctx.getVariableAlloca(updateName);
        if (!allocaReg) {
          throw new Error(`Variable ${updateName} not found in update`);
        }
        const varType = this.ctx.getVariableType(updateName) || "double";
        const valType = this.ctx.getVariableType(value);
        if (varType === "double" && valType === "i64") {
          value = this.ctx.ensureDouble(value);
        } else if (varType === "i64" && valType === "double") {
          value = this.ctx.ensureI64(value);
        }
        this.ctx.emitStore(varType, value, allocaReg);
      } else {
        // It's an expression (like i++)
        this.ctx.generateExpression(forStmt.update as Expression, params);
      }
    }
    this.ctx.emitBr(condLabel);

    // End block
    this.ctx.emitLabel(endLabel);

    return "0";
  }

  generateForOfStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "for_of") {
      throw new Error("Expected for...of statement");
    }

    const forOfStmt = stmt as {
      type: string;
      variableKind: string;
      variableName: string;
      destructuredNames: string[] | null;
      iterable: Expression;
      body: BlockStatement;
    };

    const objectArrayInfo = this.getObjectArrayInfo(forOfStmt.iterable);
    if (objectArrayInfo) {
      return this.generateObjectArrayForOf(stmt, params, objectArrayInfo);
    }

    if (
      forOfStmt.destructuredNames &&
      forOfStmt.destructuredNames.length === 2 &&
      this.isMapEntriesCall(forOfStmt.iterable)
    ) {
      return this.generateMapEntriesForOf(stmt, params);
    }

    const iterableValue = this.ctx.generateExpression(forOfStmt.iterable, params);

    const isStringArray = this.ctx.isStringArrayExpression(forOfStmt.iterable);
    const isObjectArray = !isStringArray && this.ctx.isObjectArrayExpression(forOfStmt.iterable);
    const isStringSet = this.isStringSetExpression(forOfStmt.iterable);
    let arrayType: string = "";
    let elementType: string = "";
    let elementKind: number = SymbolKind.Number;

    if (isStringSet) {
      arrayType = "%StringSet";
      elementType = "i8*";
      elementKind = SymbolKind.String;
    } else if (isStringArray) {
      arrayType = "%StringArray";
      elementType = "i8*";
      elementKind = SymbolKind.String;
    } else if (isObjectArray) {
      arrayType = "%ObjectArray";
      elementType = "i8*";
      elementKind = SymbolKind.Object;
    } else {
      arrayType = "%Array";
      elementType = "double";
      elementKind = SymbolKind.Number;
    }

    const lenPtr = this.nextTemp();
    this.emit(
      `${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${iterableValue}, i32 0, i32 1`,
    );
    const lengthI32 = this.nextTemp();
    this.emit(`${lengthI32} = load i32, i32* ${lenPtr}`);

    const indexAlloca = this.ctx.nextAllocaReg("__forof_idx");
    this.emit(`${indexAlloca} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexAlloca);

    const elemAlloca = this.ctx.nextAllocaReg(forOfStmt.variableName);
    this.emit(`${elemAlloca} = alloca ${elementType}`);

    this.ctx.defineVariable(forOfStmt.variableName, elemAlloca, elementType, elementKind, "local");

    const condLabel = this.nextLabel("forof_cond");
    const bodyLabel = this.nextLabel("forof_body");
    const updateLabel = this.nextLabel("forof_update");
    const endLabel = this.nextLabel("forof_end");

    // Jump to condition check
    this.ctx.emitBr(condLabel);

    // Condition block: check if index < length
    this.ctx.emitLabel(condLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexAlloca);
    const condBool = this.ctx.emitIcmp("slt", "i32", currentIndex, lengthI32);
    this.ctx.emitBrCond(condBool, bodyLabel, endLabel);

    // Body block
    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);

    // Load current element from array
    // Get pointer to the data array
    const dataPtr = this.nextTemp();
    this.emit(
      `${dataPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${iterableValue}, i32 0, i32 0`,
    );
    let dataArray: string;
    if (isStringSet || isStringArray) {
      dataArray = this.nextTemp();
      this.emit(`${dataArray} = load i8**, i8*** ${dataPtr}`);
    } else if (isObjectArray) {
      const dataI8 = this.nextTemp();
      this.emit(`${dataI8} = load i8*, i8** ${dataPtr}`);
      dataArray = this.ctx.emitBitcast(dataI8, "i8*", "i8**");
    } else {
      dataArray = this.nextTemp();
      this.emit(`${dataArray} = load double*, double** ${dataPtr}`);
    }

    // Load the element at current index
    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sext i32 ${currentIndex} to i64`);
    const elemPtr = this.nextTemp();
    if (isStringSet || isStringArray || isObjectArray) {
      this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataArray}, i64 ${indexI64}`);
    } else {
      this.emit(
        `${elemPtr} = getelementptr inbounds double, double* ${dataArray}, i64 ${indexI64}`,
      );
    }
    const elemValue = this.ctx.emitLoad(elementType, elemPtr);

    // Store in loop variable
    this.ctx.emitStore(elementType, elemValue, elemAlloca);

    // Execute the loop body
    this.loopContinueLabels.push(updateLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(forOfStmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();

    // Check if body has terminator
    const bodyHasTerminator4 = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator4) {
      this.ctx.emitBr(updateLabel);
    }

    // Update block: increment index
    this.ctx.emitLabel(updateLabel);
    const loadedIndex = this.ctx.emitLoad("i32", indexAlloca);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${loadedIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexAlloca);
    this.ctx.emitBr(condLabel);

    // End block
    this.ctx.emitLabel(endLabel);

    return "0";
  }

  private parseInlineObjectType(typeStr: string): { name: string; type: string }[] | null {
    let str = typeStr.trim();
    if (str.endsWith("[]")) {
      str = str.slice(0, -2).trim();
    }
    if (!str.startsWith("{") || !str.endsWith("}")) {
      return null;
    }
    str = str.slice(1, -1).trim();
    const fields: { name: string; type: string }[] = [];
    const parts = str.split(";");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      const colonIdx = part.indexOf(":");
      if (colonIdx === -1) continue;
      const name = part.slice(0, colonIdx).trim();
      const type = part.slice(colonIdx + 1).trim();
      fields.push({ name, type });
    }
    return fields.length > 0 ? fields : null;
  }

  private getObjectArrayInfoFromAST(varName: string, propName: string): ObjectArrayMetadata | null {
    const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
    if (!objMeta) {
      return null;
    }
    const tsTypes: string[] = objMeta.tsTypes as string[];
    const keys: string[] = objMeta.keys as string[];
    if (!tsTypes || !keys) {
      return null;
    }
    const idx = keys.indexOf(propName);
    if (idx === -1) {
      return null;
    }
    const fieldType = tsTypes[idx];
    if (!fieldType || !fieldType.endsWith("[]")) {
      return null;
    }
    const elementInterface = fieldType.slice(0, -2).trim();
    if (elementInterface.startsWith("{")) {
      const fields = this.parseInlineObjectType(fieldType);
      if (fields) {
        const elementKeys: string[] = [];
        const elementTypes: string[] = [];
        const elementTsTypes: string[] = [];
        for (let i = 0; i < fields.length; i++) {
          const fRaw = fields[i];
          if (!fRaw) continue;
          const f = fRaw as { name: string; type: string };
          if (!f.name || !f.type) continue;
          elementKeys.push(f.name);
          elementTsTypes.push(f.type);
          if (f.type === "string") {
            elementTypes.push("i8*");
          } else if (f.type === "number") {
            elementTypes.push("double");
          } else if (f.type === "boolean") {
            elementTypes.push("i32");
          } else {
            elementTypes.push("i8*");
          }
        }
        return {
          elementInterfaceName: "__inline",
          elementKeys,
          elementTypes,
          elementTsTypes,
        };
      }
    }
    const iface = this.ctx.getInterfaceFromAST(elementInterface);
    if (iface) {
      const ifaceTyped = iface as InterfaceDeclaration;
      const allFields = this.ctx.getAllInterfaceFields(ifaceTyped);
      const elementKeys: string[] = [];
      const elementTypes: string[] = [];
      const elementTsTypes: string[] = [];
      for (let i = 0; i < allFields.length; i++) {
        const fRaw = allFields[i];
        if (!fRaw) continue;
        const f = fRaw as { name: string; type: string };
        if (!f.name || !f.type) continue;
        elementKeys.push(f.name);
        elementTsTypes.push(f.type);
        if (f.type === "string") {
          elementTypes.push("i8*");
        } else if (f.type === "number") {
          elementTypes.push("double");
        } else if (f.type === "boolean") {
          elementTypes.push("i32");
        } else {
          elementTypes.push("i8*");
        }
      }
      return {
        elementInterfaceName: ifaceTyped.name,
        elementKeys,
        elementTypes,
        elementTsTypes,
      };
    }

    if (this.ctx.isTypeAlias(elementInterface)) {
      const commonProps = this.ctx.getTypeAliasCommonProperties(elementInterface);
      if (commonProps && commonProps.keys.length > 0) {
        return {
          elementInterfaceName: elementInterface,
          elementKeys: commonProps.keys,
          elementTypes: commonProps.types,
          elementTsTypes: commonProps.tsTypes,
        };
      }
    }

    return null;
  }

  private getInterfaceFieldType(interfaceName: string, fieldName: string): string | null {
    const iface = this.ctx.getInterfaceFromAST(interfaceName);
    if (!iface) return null;
    const allFields = this.ctx.getAllInterfaceFields(iface as InterfaceDeclaration);
    for (let i = 0; i < allFields.length; i++) {
      const fRaw = allFields[i];
      if (!fRaw) continue;
      const f = fRaw as { name: string; type: string };
      if (!f.name) continue;
      if (f.name === fieldName) {
        return f.type;
      }
    }
    return null;
  }

  private getInterfaceDecl(name: string): InterfaceDeclaration | null {
    return this.ctx.getInterfaceDeclByName(name);
  }

  private getObjectArrayInfo(iterable: Expression): ObjectArrayMetadata | null {
    if (!iterable || !iterable.type) {
      return null;
    }
    if (iterable.type === "binary") {
      const binaryExpr = iterable as BinaryNode;
      if (binaryExpr.op === "||") {
        const leftInfo = this.getObjectArrayInfo(binaryExpr.left);
        if (leftInfo) {
          return leftInfo;
        }
      }
    }

    if (iterable.type === "member_access") {
      const memberAccess = iterable as MemberAccessNode;
      const memberAccessObjBase = memberAccess.object as ExprBase;
      if (memberAccessObjBase.type === "variable") {
        const varName = (memberAccess.object as VariableNode).name;
        const propName = memberAccess.property;
        const fromAST = this.getObjectArrayInfoFromAST(varName, propName);
        if (fromAST) {
          return fromAST;
        }
        const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
        if (objMeta && objMeta.tsTypes) {
          const keys: string[] = objMeta.keys as string[];
          const tsTypes: string[] = objMeta.tsTypes as string[];
          const idx = keys.indexOf(propName);
          if (idx !== -1) {
            const fieldType = tsTypes[idx];
            if (fieldType && fieldType.endsWith("[]")) {
              const fields = this.parseInlineObjectType(fieldType);
              if (fields) {
                const elementKeys: string[] = [];
                const elementTypes: string[] = [];
                const elementTsTypes: string[] = [];
                for (let i = 0; i < fields.length; i++) {
                  const fRaw = fields[i];
                  if (!fRaw) continue;
                  const f = fRaw as { name: string; type: string };
                  if (!f.name || !f.type) continue;
                  elementKeys.push(f.name);
                  elementTsTypes.push(f.type);
                  if (f.type === "string") {
                    elementTypes.push("i8*");
                  } else if (f.type === "number") {
                    elementTypes.push("double");
                  } else if (f.type === "boolean") {
                    elementTypes.push("i32");
                  } else {
                    elementTypes.push("i8*");
                  }
                }
                return {
                  elementInterfaceName: "__inline",
                  elementKeys,
                  elementTypes,
                  elementTsTypes,
                };
              }
            }
          }
        }
        const paramTypeInfo = this.getParameterTypeFromAST(varName);
        if (paramTypeInfo) {
          const fieldType = this.getInterfaceFieldType(paramTypeInfo, propName);
          if (fieldType && fieldType.endsWith("[]")) {
            const fields = this.parseInlineObjectType(fieldType);
            if (fields) {
              const elementKeys: string[] = [];
              const elementTypes: string[] = [];
              const elementTsTypes: string[] = [];
              for (let i = 0; i < fields.length; i++) {
                const f = fields[i] as { name: string; type: string };
                elementKeys.push(f.name);
                elementTsTypes.push(f.type);
                if (f.type === "string") {
                  elementTypes.push("i8*");
                } else if (f.type === "number") {
                  elementTypes.push("double");
                } else if (f.type === "boolean") {
                  elementTypes.push("i32");
                } else {
                  elementTypes.push("i8*");
                }
              }
              return {
                elementInterfaceName: "__inline",
                elementKeys,
                elementTypes,
                elementTsTypes,
              };
            }
            const elementIfaceName = fieldType.slice(0, -2).trim();
            const elemIface = this.ctx.getInterfaceFromAST(elementIfaceName);
            if (elemIface) {
              const elemIfaceTyped = elemIface as InterfaceDeclaration;
              const allFields = this.ctx.getAllInterfaceFields(elemIfaceTyped);
              const elementKeys: string[] = [];
              const elementTypes: string[] = [];
              const elementTsTypes: string[] = [];
              for (let i = 0; i < allFields.length; i++) {
                const fRaw = allFields[i];
                if (!fRaw) continue;
                const f = fRaw as { name: string; type: string };
                if (!f.name || !f.type) continue;
                elementKeys.push(f.name);
                elementTsTypes.push(f.type);
                if (f.type === "string") {
                  elementTypes.push("i8*");
                } else if (f.type === "number") {
                  elementTypes.push("double");
                } else if (f.type === "boolean") {
                  elementTypes.push("i32");
                } else {
                  elementTypes.push("i8*");
                }
              }
              return {
                elementInterfaceName: elemIfaceTyped.name,
                elementKeys,
                elementTypes,
                elementTsTypes,
              };
            }
          }
        }
      }

      const chainedInfo = this.getChainedMemberAccessArrayInfo(iterable as MemberAccessNode);
      if (chainedInfo) {
        return chainedInfo;
      }
    }

    if (iterable.type === "method_call") {
      const methodCallInfo = this.getMethodCallArrayInfo(iterable as MethodCallNode);
      if (methodCallInfo) {
        return methodCallInfo;
      }
    }

    if (iterable.type === "variable") {
      const varName = (iterable as VariableNode).name;
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return objArrayMeta;
      }
    }

    return null;
  }

  private resolveMemberAccessChainType(expr: Expression): string | null {
    const exprBase = expr as ExprBase;

    if (exprBase.type === "this") {
      return this.ctx.getCurrentClassName() || null;
    }

    if (exprBase.type === "variable") {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        const classMeta = this.ctx.symbolTable.getClassInfo(varName);
        return classMeta ? classMeta.className : null;
      }
      const interfaceType = this.ctx.symbolTable.getInterfaceType(varName);
      if (interfaceType) {
        return interfaceType;
      }
      return null;
    }

    if (exprBase.type === "member_access") {
      const ma = expr as MemberAccessNode;
      const baseType = this.resolveMemberAccessChainType(ma.object);
      if (!baseType) return null;

      const fieldInfo = this.ctx.classGenGetFieldInfo(baseType, ma.property);
      if (fieldInfo && fieldInfo.tsType) {
        return fieldInfo.tsType;
      }

      const iface = this.ctx.getInterfaceFromAST(baseType);
      if (iface) {
        const allFields = this.ctx.getAllInterfaceFields(iface as InterfaceDeclaration);
        for (let i = 0; i < allFields.length; i++) {
          const fRaw = allFields[i];
          if (!fRaw) continue;
          const f = fRaw as { name: string; type: string };
          if (!f.name) continue;
          const fieldName = f.name.replace("?", "");
          if (fieldName === ma.property) {
            return f.type;
          }
        }
      }
    }

    return null;
  }

  private getChainedMemberAccessArrayInfo(
    memberAccess: MemberAccessNode,
  ): ObjectArrayMetadata | null {
    const propName = memberAccess.property;

    const baseTypeName = this.resolveMemberAccessChainType(memberAccess.object);
    if (!baseTypeName) {
      return null;
    }

    const iface = this.ctx.getInterfaceFromAST(baseTypeName);
    if (!iface) {
      return null;
    }
    const ifaceTyped = iface as InterfaceDeclaration;
    const chainedAllFields = this.ctx.getAllInterfaceFields(ifaceTyped);

    let fieldDefResult: InterfaceField | null = null;
    for (let i = 0; i < chainedAllFields.length; i++) {
      const fRaw = chainedAllFields[i];
      if (!fRaw) continue;
      const f = fRaw as { name: string; type: string };
      if (!f.name) continue;
      const fieldName = f.name.replace("?", "");
      if (fieldName === propName) {
        fieldDefResult = f as { name: string; type: string };
        break;
      }
    }
    const fieldDef = fieldDefResult as { name: string; type: string };
    if (!fieldDefResult || !fieldDef.type.endsWith("[]")) {
      return null;
    }

    const elementTypeName = fieldDef.type.slice(0, -2).trim();

    if (elementTypeName.startsWith("{")) {
      const fields = this.parseInlineObjectType(fieldDef.type);
      if (fields) {
        const elementKeys: string[] = [];
        const elementTypes: string[] = [];
        const elementTsTypes: string[] = [];
        for (let i = 0; i < fields.length; i++) {
          const fRaw = fields[i];
          if (!fRaw) continue;
          const f = fRaw as { name: string; type: string };
          if (!f.name || !f.type) continue;
          elementKeys.push(f.name);
          elementTsTypes.push(f.type);
          if (f.type === "string") {
            elementTypes.push("i8*");
          } else if (f.type === "number") {
            elementTypes.push("double");
          } else if (f.type === "boolean") {
            elementTypes.push("i32");
          } else {
            elementTypes.push("i8*");
          }
        }
        return {
          elementInterfaceName: "__inline",
          elementKeys,
          elementTypes,
          elementTsTypes,
        };
      }
    }

    if (elementTypeName.startsWith("(") && elementTypeName.endsWith(")")) {
      const unionInfo = this.parseUnionTypeCommonProperties(elementTypeName);
      if (unionInfo) {
        return unionInfo;
      }
    }

    const typeAliasInfo = this.resolveTypeAliasUnion(elementTypeName);
    if (typeAliasInfo) {
      return typeAliasInfo;
    }

    const elementIface = this.ctx.getInterfaceFromAST(elementTypeName);
    if (elementIface) {
      const elementIfaceTyped = elementIface as InterfaceDeclaration;
      const elementAllFields = this.ctx.getAllInterfaceFields(elementIfaceTyped);
      const elementKeys: string[] = [];
      const elementTypes: string[] = [];
      const elementTsTypes: string[] = [];
      for (let i = 0; i < elementAllFields.length; i++) {
        const f = elementAllFields[i] as { name: string; type: string };
        elementKeys.push(f.name);
        elementTsTypes.push(f.type);
        if (f.type === "string") {
          elementTypes.push("i8*");
        } else if (f.type === "number") {
          elementTypes.push("double");
        } else if (f.type === "boolean") {
          elementTypes.push("i32");
        } else {
          elementTypes.push("i8*");
        }
      }
      return {
        elementInterfaceName: elementIfaceTyped.name,
        elementKeys,
        elementTypes,
        elementTsTypes,
      };
    }

    return null;
  }

  private getMethodCallArrayInfo(methodCall: MethodCallNode): ObjectArrayMetadata | null {
    const objType = this.resolveMemberAccessChainType(methodCall.object);
    if (!objType) {
      return null;
    }

    const returnType = this.getMethodReturnType(objType, methodCall.method);
    if (!returnType || !returnType.endsWith("[]")) {
      return null;
    }

    const elementTypeName = returnType.slice(0, -2).trim();

    if (elementTypeName.startsWith("{")) {
      const fields = this.parseInlineObjectType(returnType);
      if (fields) {
        const elementKeys: string[] = [];
        const elementTypes: string[] = [];
        const elementTsTypes: string[] = [];
        for (let i = 0; i < fields.length; i++) {
          const fRaw = fields[i];
          if (!fRaw) continue;
          const f = fRaw as { name: string; type: string };
          if (!f.name || !f.type) continue;
          elementKeys.push(f.name);
          elementTsTypes.push(f.type);
          if (f.type === "string") {
            elementTypes.push("i8*");
          } else if (f.type === "number") {
            elementTypes.push("double");
          } else if (f.type === "boolean") {
            elementTypes.push("i32");
          } else {
            elementTypes.push("i8*");
          }
        }
        return {
          elementInterfaceName: "__inline",
          elementKeys,
          elementTypes,
          elementTsTypes,
        };
      }
    }

    const typeAliasInfo = this.resolveTypeAliasUnion(elementTypeName);
    if (typeAliasInfo) {
      return typeAliasInfo;
    }

    const elementIface = this.ctx.getInterfaceFromAST(elementTypeName);
    if (elementIface) {
      const elementIfaceTyped = elementIface as InterfaceDeclaration;
      const elementAllFields = this.ctx.getAllInterfaceFields(elementIfaceTyped);
      const elementKeys: string[] = [];
      const elementTypes: string[] = [];
      const elementTsTypes: string[] = [];
      for (let i = 0; i < elementAllFields.length; i++) {
        const f = elementAllFields[i] as { name: string; type: string };
        elementKeys.push(f.name);
        elementTsTypes.push(f.type);
        if (f.type === "string") {
          elementTypes.push("i8*");
        } else if (f.type === "number") {
          elementTypes.push("double");
        } else if (f.type === "boolean") {
          elementTypes.push("i32");
        } else {
          elementTypes.push("i8*");
        }
      }
      return {
        elementInterfaceName: elementIfaceTyped.name,
        elementKeys,
        elementTypes,
        elementTsTypes,
      };
    }

    return null;
  }

  private getMethodReturnType(className: string, methodName: string): string | null {
    return this.ctx.getMethodReturnType(className, methodName);
  }

  private resolveTypeAliasUnion(typeName: string): ObjectArrayMetadata | null {
    if (!this.ctx.isTypeAlias(typeName)) {
      return null;
    }
    const commonProps = this.ctx.getTypeAliasCommonProperties(typeName);
    if (!commonProps || commonProps.keys.length === 0) {
      return null;
    }
    return {
      elementInterfaceName: typeName,
      elementKeys: commonProps.keys,
      elementTypes: commonProps.types,
      elementTsTypes: commonProps.tsTypes,
    };
  }

  private parseUnionTypeCommonProperties(unionType: string): ObjectArrayMetadata | null {
    const inner = unionType.slice(1, -1).trim();
    const rawMembers = inner.split("|");
    const members: string[] = [];
    for (let mi = 0; mi < rawMembers.length; mi++) {
      members.push(rawMembers[mi].trim());
    }
    if (members.length === 0) {
      return null;
    }

    const memberInterfaces: InterfaceDeclaration[] = [];
    for (let i = 0; i < members.length; i++) {
      const memberName = members[i];
      const iface = this.ctx.getInterfaceFromAST(memberName);
      if (!iface) {
        return null;
      }
      memberInterfaces.push(iface as InterfaceDeclaration);
    }

    if (memberInterfaces.length === 0) {
      return null;
    }

    const firstFields = new Map<string, string>();
    const firstInterface = memberInterfaces[0];
    const firstInterfaceAllFields = this.ctx.getAllInterfaceFields(firstInterface);
    for (let i = 0; i < firstInterfaceAllFields.length; i++) {
      const f = firstInterfaceAllFields[i] as { name: string; type: string };
      firstFields.set(f.name, f.type);
    }

    const commonFields: CommonField[] = [];
    for (let _ffi = 0; _ffi < firstInterfaceAllFields.length; _ffi++) {
      const firstField = firstInterfaceAllFields[_ffi] as { name: string; type: string };
      const fieldName = firstField.name;
      const fieldType = firstField.type;
      let isCommon = true;
      let resolvedType = fieldType;
      for (let i = 1; i < memberInterfaces.length; i++) {
        const otherIface = memberInterfaces[i];
        const otherAllFields = this.ctx.getAllInterfaceFields(otherIface);
        let otherFieldResult: InterfaceField | null = null;
        for (let j = 0; j < otherAllFields.length; j++) {
          const f = otherAllFields[j] as { name: string; type: string };
          if (f.name === fieldName) {
            otherFieldResult = f;
            break;
          }
        }
        const otherField = otherFieldResult as { name: string; type: string };
        if (!otherFieldResult) {
          isCommon = false;
          break;
        }
        if (otherField.type !== fieldType) {
          const bothAreLiteralStrings =
            this.isStringLiteralType(fieldType) && this.isStringLiteralType(otherField.type);
          const areNullableCompatible = this.areNullableCompatible(fieldType, otherField.type);
          if (bothAreLiteralStrings) {
            resolvedType = "string";
          } else if (areNullableCompatible) {
            resolvedType =
              this.getNullableBaseType(fieldType) ||
              this.getNullableBaseType(otherField.type) ||
              fieldType;
          } else {
            isCommon = false;
            break;
          }
        }
      }
      if (isCommon) {
        const normalizedType = this.isStringLiteralType(resolvedType) ? "string" : resolvedType;
        commonFields.push({ name: fieldName, type: normalizedType });
      }
    }

    if (commonFields.length === 0) {
      return null;
    }

    const elementKeys: string[] = [];
    const elementTypes: string[] = [];
    const elementTsTypes: string[] = [];
    for (let i = 0; i < commonFields.length; i++) {
      const f = commonFields[i] as CommonField;
      elementKeys.push(f.name);
      elementTsTypes.push(f.type);
      if (f.type === "string") {
        elementTypes.push("i8*");
      } else if (f.type === "number") {
        elementTypes.push("double");
      } else if (f.type === "boolean") {
        elementTypes.push("i32");
      } else {
        elementTypes.push("i8*");
      }
    }

    return {
      elementInterfaceName: "__union",
      elementKeys,
      elementTypes,
      elementTsTypes,
    };
  }

  private isStringLiteralType(typeStr: string): boolean {
    return typeStr.startsWith("'") && typeStr.endsWith("'");
  }

  private areNullableCompatible(type1: string, type2: string): boolean {
    const base1 = this.getNullableBaseType(type1);
    const base2 = this.getNullableBaseType(type2);
    if (base1 && base2) {
      return base1 === base2;
    }
    if (base1) {
      return base1 === type2;
    }
    if (base2) {
      return type1 === base2;
    }
    return false;
  }

  private getNullableBaseType(typeStr: string): string | null {
    if (typeStr.indexOf(" | null") !== -1) {
      return typeStr.replace(" | null", "").trim();
    }
    if (typeStr.indexOf("| null") !== -1) {
      return typeStr.replace("| null", "").trim();
    }
    return null;
  }

  private getParameterTypeFromAST(paramName: string): string | null {
    return this.ctx.getParameterTypeFromAST(paramName);
  }

  private generateObjectArrayForOf(
    stmt: Statement,
    params: string[],
    objArrayInfo: ObjectArrayMetadata,
  ): string {
    if (stmt.type !== "for_of") {
      throw new Error("Expected for...of statement");
    }

    const forOfStmt = stmt as {
      type: string;
      variableKind: string;
      variableName: string;
      destructuredNames: string[] | null;
      iterable: Expression;
      body: BlockStatement;
    };

    const iterableValue = this.ctx.generateExpression(forOfStmt.iterable, params);

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${iterableValue}, i32 0, i32 1`);
    const lengthI32 = this.nextTemp();
    this.emit(`${lengthI32} = load i32, i32* ${lenPtr}`);

    const indexAlloca = this.ctx.nextAllocaReg("__forof_idx");
    this.emit(`${indexAlloca} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexAlloca);

    const elemAlloca = this.ctx.nextAllocaReg(forOfStmt.variableName);
    this.emit(`${elemAlloca} = alloca i8*`);

    const objectMetadata = {
      keys: objArrayInfo.elementKeys,
      types: objArrayInfo.elementTypes,
      tsTypes: objArrayInfo.elementTsTypes,
    };
    const hasInterfaceName =
      objArrayInfo.elementInterfaceName && objArrayInfo.elementInterfaceName !== "__inline";
    const metadata = hasInterfaceName
      ? createObjectMetadataWithInterface(objectMetadata, objArrayInfo.elementInterfaceName)
      : createObjectMetadata(objectMetadata);
    this.ctx.defineVariableWithMetadata(
      forOfStmt.variableName,
      elemAlloca,
      "i8*",
      SymbolKind.Object,
      "local",
      metadata,
    );

    const condLabel = this.nextLabel("forof_cond");
    const bodyLabel = this.nextLabel("forof_body");
    const updateLabel = this.nextLabel("forof_update");
    const endLabel = this.nextLabel("forof_end");

    this.ctx.emitBr(condLabel);

    this.ctx.emitLabel(condLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexAlloca);
    const condBool = this.ctx.emitIcmp("slt", "i32", currentIndex, lengthI32);
    this.ctx.emitBrCond(condBool, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);

    // inbounds GEP loads stay raw
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = getelementptr inbounds %Array, %Array* ${iterableValue}, i32 0, i32 0`);
    const dataArray = this.nextTemp();
    this.emit(`${dataArray} = load double*, double** ${dataPtr}`);

    const elemPtrRaw = this.ctx.emitBitcast(dataArray, "double*", "i8**");

    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sext i32 ${currentIndex} to i64`);
    const elemPtrPtr = this.nextTemp();
    this.emit(`${elemPtrPtr} = getelementptr inbounds i8*, i8** ${elemPtrRaw}, i64 ${indexI64}`);
    const elemValue = this.ctx.emitLoad("i8*", elemPtrPtr);

    this.ctx.emitStore("i8*", elemValue, elemAlloca);

    this.loopContinueLabels.push(updateLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(forOfStmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();

    const bodyHasTerminator5 = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator5) {
      this.ctx.emitBr(updateLabel);
    }

    this.ctx.emitLabel(updateLabel);
    const loadedIndex = this.ctx.emitLoad("i32", indexAlloca);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${loadedIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexAlloca);
    this.ctx.emitBr(condLabel);

    this.ctx.emitLabel(endLabel);

    return "0";
  }

  generateBreakStatement(): string {
    if (this.loopBreakLabels.length === 0) {
      throw new Error("break statement outside of loop");
    }
    const breakLabel = this.loopBreakLabels[this.loopBreakLabels.length - 1];
    this.ctx.emitBr(breakLabel);
    return "0";
  }

  generateContinueStatement(): string {
    if (this.loopContinueLabels.length === 0) {
      throw new Error("continue statement outside of loop");
    }
    const continueLabel = this.loopContinueLabels[this.loopContinueLabels.length - 1];
    this.ctx.emitBr(continueLabel);
    return "0";
  }

  generateThrowStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "throw") {
      throw new Error("Expected throw statement");
    }

    const throwStmt = stmt as ThrowStatement;
    let msgVal: string = "null";

    if (throwStmt.argument) {
      const argTyped = throwStmt.argument as {
        type: string;
        className?: string;
        args?: Expression[];
      };
      if (
        argTyped.type === "new" &&
        argTyped.className === "Error" &&
        argTyped.args &&
        argTyped.args.length > 0
      ) {
        const msgArg = argTyped.args[0];
        msgVal = this.ctx.generateExpression(msgArg, params);
      } else {
        msgVal = this.ctx.generateExpression(throwStmt.argument, params);
        const msgType = this.ctx.getVariableType(msgVal);
        if (msgType === "double") {
          msgVal = this.ctx.emitCall("i8*", "@__double_to_string", `double ${msgVal}`);
        }
      }
    }

    this.ctx.emitStore("i8*", msgVal, "@__exception_message");

    const framePtr = this.ctx.emitLoad("i8*", "@__exception_stack");
    const hasHandler = this.ctx.emitIcmp("ne", "i8*", framePtr, "null");
    const doLongjmpLabel = this.nextLabel("do_longjmp");
    const noHandlerLabel = this.nextLabel("no_handler");
    this.ctx.emitBrCond(hasHandler, doLongjmpLabel, noHandlerLabel);

    this.ctx.emitLabel(doLongjmpLabel);
    this.ctx.setCurrentLabel(doLongjmpLabel);
    const frameTyped = this.ctx.emitBitcast(framePtr, "i8*", "%ExceptionFrame*");
    const bufPtr = this.ctx.emitGep("%ExceptionFrame", frameTyped, "i32 0, i32 0, i32 0");
    this.emit(`call void @longjmp(i8* ${bufPtr}, i32 1)`);
    this.emit(`unreachable`);

    this.ctx.emitLabel(noHandlerLabel);
    this.ctx.setCurrentLabel(noHandlerLabel);
    const stderrPtr = this.ctx.emitLoad("i8*", "@stderr");
    const fprintfResult = this.ctx.nextTemp();
    this.emit(
      `${fprintfResult} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([11 x i8], [11 x i8]* @.str.throw_fmt, i32 0, i32 0), i8* ${msgVal})`,
    );
    this.emit(`call void @exit(i32 1)`);
    this.emit(`unreachable`);
    return "0";
  }

  generateTryStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "try") {
      throw new Error("Expected try statement");
    }
    const tryStmt = stmt as {
      type: string;
      tryBlock: BlockStatement;
      catchParam: string | null;
      catchBody: BlockStatement | null;
      finallyBlock: BlockStatement | null;
    };

    const frameRaw = this.ctx.emitCall("i8*", "@GC_malloc", "i64 216");
    const frame = this.ctx.emitBitcast(frameRaw, "i8*", "%ExceptionFrame*");

    const prevFrame = this.ctx.emitLoad("i8*", "@__exception_stack");
    const prevField = this.ctx.emitGep("%ExceptionFrame", frame, "i32 0, i32 1");
    this.ctx.emitStore("i8*", prevFrame, prevField);
    this.ctx.emitStore("i8*", frameRaw, "@__exception_stack");

    const bufPtr = this.ctx.emitGep("%ExceptionFrame", frame, "i32 0, i32 0, i32 0");
    const sjVal = this.ctx.emitCall("i32", "@setjmp", `i8* ${bufPtr}`);
    const isException = this.ctx.emitIcmp("ne", "i32", sjVal, "0");

    const tryBodyLabel = this.nextLabel("try_body");
    const catchEntryLabel = this.nextLabel("catch_entry");
    const finallyLabel = this.nextLabel("finally_block");

    this.ctx.emitBrCond(isException, catchEntryLabel, tryBodyLabel);

    this.ctx.emitLabel(tryBodyLabel);
    this.ctx.setCurrentLabel(tryBodyLabel);
    this.ctx.generateBlock(tryStmt.tryBlock, params);
    const tryHasTerminator = this.ctx.lastInstructionIsTerminator();
    if (!tryHasTerminator) {
      this.ctx.emitStore("i8*", prevFrame, "@__exception_stack");
      this.ctx.emitBr(finallyLabel);
    }

    this.ctx.emitLabel(catchEntryLabel);
    this.ctx.setCurrentLabel(catchEntryLabel);
    this.ctx.emitStore("i8*", prevFrame, "@__exception_stack");

    if (tryStmt.catchBody) {
      const paramName = tryStmt.catchParam;
      if (paramName) {
        const excMsg = this.ctx.emitLoad("i8*", "@__exception_message");
        const paramAlloca = this.ctx.nextAllocaReg(paramName);
        this.emit(`${paramAlloca} = alloca i8*`);
        this.ctx.emitStore("i8*", excMsg, paramAlloca);
        this.ctx.defineVariable(paramName, paramAlloca, "i8*", SymbolKind.String, "local");
      }
      this.ctx.generateBlock(tryStmt.catchBody, params);
    }

    const catchHasTerminator = this.ctx.lastInstructionIsTerminator();
    if (!catchHasTerminator) {
      this.ctx.emitBr(finallyLabel);
    }

    this.ctx.emitLabel(finallyLabel);
    this.ctx.setCurrentLabel(finallyLabel);

    if (tryStmt.finallyBlock) {
      this.ctx.generateBlock(tryStmt.finallyBlock, params);
    }

    return "0";
  }

  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string {
    const leftValue = this.ctx.generateExpression(left, params);
    const leftType = this.ctx.getVariableType(leftValue) || "double";
    let leftBool: string;
    if (op === "??") {
      leftBool = this.convertToNonNullish(leftValue, leftType);
    } else {
      leftBool = this.convertToBool(leftValue);
    }

    const evalRightLabel = this.nextLabel("logop_eval_right");
    const endLabel = this.nextLabel("logop_end");
    const leftCoerceLabel = this.nextLabel("logop_left_coerce");

    if (op === "||" || op === "??") {
      this.ctx.emitBrCond(leftBool, leftCoerceLabel, evalRightLabel);
    } else {
      this.ctx.emitBrCond(leftBool, evalRightLabel, leftCoerceLabel);
    }

    this.ctx.emitLabel(evalRightLabel);
    const savedExpectedType = this.ctx.getExpectedArrayElementType();
    const rightTyped = right as ArrayNode;
    if (rightTyped.type === "array" && (!rightTyped.elements || rightTyped.elements.length === 0)) {
      if (savedExpectedType === null) {
        if (leftType === "%StringArray*") {
          this.ctx.setExpectedArrayElementType("string");
        } else if (leftType === "%ObjectArray*") {
          this.ctx.setExpectedArrayElementType("pointer");
        }
      }
    }
    const rightValue = this.ctx.generateExpression(right, params);
    this.ctx.setExpectedArrayElementType(savedExpectedType);
    const rightType = this.ctx.getVariableType(rightValue) || "double";
    const resultType = this.getPhiType(leftType, rightType);
    const rightForPhi = this.coerceToTypeNoPhi(rightValue, rightType, resultType);
    const rightCoerceEndLabel = this.ctx.getCurrentLabel();
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(leftCoerceLabel);
    const leftForPhi = this.coerceToTypeNoPhi(leftValue, leftType, resultType);
    const leftCoerceEndLabel = this.ctx.getCurrentLabel();
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.nextTemp();
    this.emit(
      `${result} = phi ${resultType} [ ${leftForPhi}, %${leftCoerceEndLabel} ], [ ${rightForPhi}, %${rightCoerceEndLabel} ]`,
    );
    this.ctx.setVariableType(result, resultType);
    return result;
  }

  private getPhiType(type1: string, type2: string): string {
    if (type1 === type2) return type1;
    if (type1.indexOf("*") !== -1) return type1;
    if (type2.indexOf("*") !== -1) return type2;
    return "double";
  }

  private coerceToTypeNoPhi(value: string, fromType: string, toType: string): string {
    if (fromType === toType) return value;
    if (toType === "double" && fromType === "i64") {
      const coerced = this.nextTemp();
      this.emit(`${coerced} = sitofp i64 ${value} to double`);
      return coerced;
    }
    if (toType === "i64" && fromType === "double") {
      const coerced = this.nextTemp();
      this.emit(`${coerced} = fptosi double ${value} to i64`);
      return coerced;
    }
    if (toType.indexOf("*") !== -1 && fromType === "i64") {
      const coerced = this.nextTemp();
      this.emit(`${coerced} = inttoptr i64 ${value} to ${toType}`);
      return coerced;
    }
    if (toType.indexOf("*") !== -1 && fromType === "double") {
      const cmp = this.nextTemp();
      this.emit(`${cmp} = fcmp one double ${value}, 0.0`);
      const zext = this.nextTemp();
      this.emit(`${zext} = zext i1 ${cmp} to i64`);
      const coerced = this.nextTemp();
      this.emit(`${coerced} = inttoptr i64 ${zext} to ${toType}`);
      return coerced;
    }
    if (toType.indexOf("*") !== -1 && fromType === "i32") {
      const extended = this.nextTemp();
      this.emit(`${extended} = sext i32 ${value} to i64`);
      const coerced = this.nextTemp();
      this.emit(`${coerced} = inttoptr i64 ${extended} to ${toType}`);
      return coerced;
    }
    return value;
  }

  private getUnionCommonFields(memberNames: string[]): {
    keys: string[];
    types: string[];
    tsTypes: string[];
  } {
    const result = this.ctx.typeResolver?.getUnionCommonFields(memberNames);
    if (result && result.keys.length > 0) {
      return { keys: result.keys, types: result.types, tsTypes: result.types };
    }

    const foundInterfaces: InterfaceDeclaration[] = [];
    for (let i = 0; i < memberNames.length; i++) {
      const name = memberNames[i];
      const ifaceResult = this.getInterfaceDecl(name);
      const iface = ifaceResult as InterfaceDeclaration;
      if (ifaceResult) {
        foundInterfaces.push(iface);
      }
    }
    const interfaces = foundInterfaces;

    if (interfaces.length === 0) {
      return { keys: [], types: [], tsTypes: [] };
    }

    const firstInterface = interfaces[0] as InterfaceDeclaration;
    const firstAllFields = this.ctx.getAllInterfaceFields(firstInterface);
    const commonFields: CommonField[] = [];

    for (let fi = 0; fi < firstAllFields.length; fi++) {
      const field = firstAllFields[fi] as { name: string; type: string };
      let isCommon = true;
      for (let ii = 0; ii < interfaces.length; ii++) {
        const ifaceTyped = interfaces[ii] as InterfaceDeclaration;
        const ifaceAllFields = this.ctx.getAllInterfaceFields(ifaceTyped);
        let found = false;
        for (let fj = 0; fj < ifaceAllFields.length; fj++) {
          const f = ifaceAllFields[fj] as { name: string; type: string };
          if (f.name === field.name && this.areTypesCompatible(f.type, field.type)) {
            found = true;
            break;
          }
        }
        if (!found) {
          isCommon = false;
          break;
        }
      }
      if (isCommon) {
        commonFields.push({ name: field.name, type: this.normalizeType(field.type) });
      }
    }

    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < commonFields.length; i++) {
      const f = commonFields[i] as CommonField;
      keys.push(stripOptional(f.name));
      types.push(this.fieldTypeToLlvm(f.type));
      tsTypes.push(f.type);
    }

    return { keys, types, tsTypes };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    const result = this.ctx.typeResolverAreTypesCompatible(type1, type2);
    if (result) {
      return result;
    }

    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  private normalizeType(type: string): string {
    const result = this.ctx.typeResolverNormalizeType(type);
    if (result && result !== type) {
      return result;
    }

    if (type.startsWith("'") && type.endsWith("'")) return "string";
    if (type.startsWith('"') && type.endsWith('"')) return "string";
    return type;
  }

  private fieldTypeToLlvmPrimitive(fieldType: string): string | null {
    if (fieldType === "string") return "i8*";
    if (fieldType === "number") return "double";
    if (fieldType === "boolean") return "double";
    if (fieldType.startsWith("'") || fieldType.startsWith('"')) return "i8*";
    return null;
  }

  private fieldTypeToLlvm(fieldType: string): string {
    const prim = this.fieldTypeToLlvmPrimitive(fieldType);
    if (prim) return prim;
    if (this.isEnumType(fieldType)) return "double";
    return "i8*";
  }

  private isEnumType(typeName: string): boolean {
    let checkType = typeName;
    if (checkType.indexOf(" | ") !== -1) {
      const parts = checkType.split(" | ");
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j].trim();
        if (part !== "undefined" && part !== "null") {
          checkType = part;
          break;
        }
      }
    }
    return this.ctx.isEnumType(checkType);
  }

  private detectTypeGuard(condition: Expression): {
    varName: string;
    narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] };
  } | null {
    if (!condition) return null;

    const result = this.ctx.typeResolverDetectTypeGuard(condition);
    if (result) {
      return {
        varName: result.varName,
        narrowedMetadata: {
          keys: result.narrowedMetadata.keys,
          types: result.narrowedMetadata.types,
          tsTypes: result.narrowedMetadata.tsTypes,
        },
      };
    }

    const parts = this.extractTypeGuardBinaryParts(condition);
    if (!parts) return null;

    return this.resolveTypeGuardFromBinary(parts.binary, parts.memberAccess, parts.literalValue);
  }

  private extractTypeGuardBinaryParts(
    condition: Expression,
  ): { binary: BinaryNode; memberAccess: MemberAccessNode; literalValue: string } | null {
    if (condition.type !== "binary") return null;

    const binary = condition as BinaryNode;
    if (binary.op !== "===" && binary.op !== "==" && binary.op !== "!==" && binary.op !== "!=")
      return null;
    if (!binary.left || !binary.right) return null;

    const leftBase = binary.left as ExprBase;
    const rightBase = binary.right as ExprBase;
    if (!leftBase.type || !rightBase.type) return null;

    let memberAccess: MemberAccessNode | null = null;
    let literalValue: string | null = null;

    if (leftBase.type === "member_access" && rightBase.type === "string") {
      memberAccess = binary.left as MemberAccessNode;
      const rightStr = binary.right as StringNode;
      literalValue = rightStr.value;
    } else if (rightBase.type === "member_access" && leftBase.type === "string") {
      memberAccess = binary.right as MemberAccessNode;
      const leftStr = binary.left as StringNode;
      literalValue = leftStr.value;
    }

    if (!memberAccess || !literalValue) return null;
    return { binary, memberAccess, literalValue };
  }

  private resolveTypeGuardFromBinary(
    binary: BinaryNode,
    memberAccess: MemberAccessNode,
    literalValue: string,
  ): {
    varName: string;
    narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] };
  } | null {
    if (memberAccess.property !== "type") return null;
    const maObjBase = memberAccess.object as ExprBase;
    if (maObjBase.type !== "variable") return null;

    const varName = (memberAccess.object as VariableNode).name;
    const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
    if (!objMeta) return null;

    const ifaceAllFields = this.resolveCompatibleInterface(literalValue, objMeta.keys as string[]);
    if (!ifaceAllFields) return null;

    if (binary.op === "!==" || binary.op === "!=") return null;

    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < ifaceAllFields.length; i++) {
      const f = ifaceAllFields[i] as { name: string; type: string };
      keys.push(stripOptional(f.name));
      types.push(this.fieldTypeToLlvm(f.type));
      tsTypes.push(f.type);
    }

    return { varName, narrowedMetadata: { keys, types, tsTypes } };
  }

  private resolveCompatibleInterface(
    discriminantValue: string,
    currentKeys: string[],
  ): object[] | null {
    const interfaceName = this.findInterfaceByDiscriminant(discriminantValue);
    if (!interfaceName) return null;

    const ifaceResult = this.getInterfaceDecl(interfaceName);
    if (!ifaceResult) return null;
    const iface = ifaceResult as InterfaceDeclaration;
    const ifaceAllFields = this.ctx.getAllInterfaceFields(iface);

    const ifaceKeys: string[] = [];
    for (let fi = 0; fi < ifaceAllFields.length; fi++) {
      const f = ifaceAllFields[fi] as { name: string; type: string };
      ifaceKeys.push(f.name);
    }
    for (let ki = 0; ki < currentKeys.length; ki++) {
      if (ifaceKeys.indexOf(currentKeys[ki]) === -1) return null;
    }

    return ifaceAllFields;
  }

  private findInterfaceByDiscriminant(discriminantValue: string): string | null {
    return this.ctx.typeResolverFindInterfaceByDiscriminant(discriminantValue);
  }

  private checkDiscriminant(
    ifaceName: string,
    fields: { name: string; type: string }[],
    discriminantValue: string,
  ): string | null {
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; type: string };
      if (f.name === "type") {
        const fieldType = f.type;
        if (fieldType === `'${discriminantValue}'` || fieldType === `"${discriminantValue}"`) {
          return ifaceName;
        }
      }
    }
    return null;
  }

  private isStringSetExpression(expr: Expression): boolean {
    const e = expr as ExprBase;

    if (e.type === "variable") {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isSet(varName)) {
        const setMeta = this.ctx.symbolTable.getSetValueType(varName);
        return !setMeta || setMeta === "string";
      }
      return false;
    }

    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      const className = this.ctx.getCurrentClassName();
      if (memberObjBase.type === "this" && className) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, memberExpr.property);
        const fieldInfo = fieldInfoResult as FieldInfo;
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith("Set<string>")) {
          return true;
        }
      }
    }

    return false;
  }

  private isMapEntriesCall(expr: Expression): boolean {
    const e = expr as ExprBase;

    if (e.type === "variable") {
      const varName = (expr as VariableNode).name;
      return this.ctx.symbolTable.isMap(varName);
    }

    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      const className = this.ctx.getCurrentClassName();
      if (memberObjBase.type === "this" && className) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, memberExpr.property);
        const fieldInfo = fieldInfoResult as FieldInfo;
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith("Map<")) {
          return true;
        }
      }
    }

    if (e.type !== "method_call") return false;
    const methodCall = expr as MethodCallNode;
    if (methodCall.method !== "entries") return false;

    const objBase = methodCall.object as ExprBase;
    if (objBase.type === "variable") {
      const varName = (methodCall.object as VariableNode).name;
      return this.ctx.symbolTable.isMap(varName);
    }

    if (objBase.type === "member_access") {
      const memberExpr = methodCall.object as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      const className = this.ctx.getCurrentClassName();
      if (memberObjBase.type === "this" && className) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, memberExpr.property);
        const fieldInfo = fieldInfoResult as FieldInfo;
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith("Map<")) {
          return true;
        }
      }
    }

    return false;
  }

  private getMapValueTypeInfo(
    iterable: Expression,
  ): { valueType: string; objectMetadata?: ObjectMetadata } | null {
    const e = iterable as ExprBase;

    let valueType: string | null = null;

    if (e.type === "variable") {
      const varName = (iterable as VariableNode).name;
      const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
      if (mapMeta) {
        valueType = mapMeta.valueType;
      }
    } else if (e.type === "member_access") {
      const memberExpr = iterable as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      const className = this.ctx.getCurrentClassName();
      if (memberObjBase.type === "this" && className) {
        const mapTypeInfo = this.ctx.typeResolver?.getClassFieldMapType(
          className,
          memberExpr.property,
        );
        if (mapTypeInfo) {
          valueType = mapTypeInfo.valueType;
        }
      }
    } else if (e.type === "method_call") {
      const methodCall = iterable as MethodCallNode;
      if (methodCall.method === "entries") {
        const methodCallObjBase = methodCall.object as ExprBase;
        if (methodCallObjBase.type === "variable") {
          const varName = (methodCall.object as VariableNode).name;
          const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
          if (mapMeta) {
            valueType = mapMeta.valueType;
          }
        } else if (methodCallObjBase.type === "member_access") {
          const memberExpr = methodCall.object as MemberAccessNode;
          const memberExprObjBase = memberExpr.object as ExprBase;
          const className2 = this.ctx.getCurrentClassName();
          if (memberExprObjBase.type === "this" && className2) {
            const mapTypeInfo = this.ctx.typeResolver?.getClassFieldMapType(
              className2,
              memberExpr.property,
            );
            if (mapTypeInfo) {
              valueType = mapTypeInfo.valueType;
            }
          }
        }
      }
    }

    if (!valueType) return null;

    if (valueType === "string" || valueType === "number") {
      return { valueType };
    }

    const metadata = this.ctx.typeResolver?.getInterfaceMetadata(valueType);
    if (metadata) {
      return { valueType, objectMetadata: metadata };
    }

    return { valueType };
  }

  private generateMapEntriesForOf(stmt: ForOfStatement, params: string[]): string {
    const destructuredNames = stmt.destructuredNames as string[];
    const keyName = destructuredNames[0];
    const valueName = destructuredNames[1];

    const valueTypeInfo = this.getMapValueTypeInfo(stmt.iterable);

    let iterableValue: string;
    const iterableBase = stmt.iterable as ExprBase;
    if (iterableBase.type === "variable") {
      const varName = (stmt.iterable as VariableNode).name;
      if (this.ctx.symbolTable.isMap(varName)) {
        const mapPtr = this.ctx.generateExpression(stmt.iterable, params);
        iterableValue = this.ctx.stringMapGen.generateStringMapEntries(mapPtr);
      } else {
        iterableValue = this.ctx.generateExpression(stmt.iterable, params);
      }
    } else if (iterableBase.type === "member_access") {
      const memberExpr = stmt.iterable as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      const classNameForLookup = this.ctx.getCurrentClassName();
      if (memberObjBase.type === "this" && classNameForLookup) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(
          classNameForLookup,
          memberExpr.property,
        );
        const fieldInfo = fieldInfoResult as FieldInfo;
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith("Map<")) {
          const mapPtr = this.ctx.generateExpression(stmt.iterable, params);
          iterableValue = this.ctx.stringMapGen.generateStringMapEntries(mapPtr);
        } else {
          iterableValue = this.ctx.generateExpression(stmt.iterable, params);
        }
      } else {
        iterableValue = this.ctx.generateExpression(stmt.iterable, params);
      }
    } else {
      iterableValue = this.ctx.generateExpression(stmt.iterable, params);
    }

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${iterableValue}, i32 0, i32 0`);
    const lengthI32 = this.ctx.emitLoad("i32", lenPtr);

    const indexAlloca = this.ctx.nextAllocaReg("__forof_idx");
    this.emit(`${indexAlloca} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexAlloca);

    const keyAlloca = this.ctx.nextAllocaReg(keyName);
    this.emit(`${keyAlloca} = alloca i8*`);
    const valueAlloca = this.ctx.nextAllocaReg(valueName);
    this.emit(`${valueAlloca} = alloca i8*`);

    this.ctx.defineVariable(keyName, keyAlloca, "i8*", SymbolKind.String, "local");

    if (valueTypeInfo) {
      const vti = valueTypeInfo as {
        valueType: string;
        objectMetadata: ObjectMetadata | undefined;
      };
      if (vti.objectMetadata) {
        this.ctx.defineVariableWithMetadata(
          valueName,
          valueAlloca,
          "i8*",
          SymbolKind.Object,
          "local",
          createObjectMetadata(vti.objectMetadata),
        );
      } else {
        this.ctx.defineVariable(valueName, valueAlloca, "i8*", SymbolKind.String, "local");
      }
    } else {
      this.ctx.defineVariable(valueName, valueAlloca, "i8*", SymbolKind.String, "local");
    }

    const condLabel = this.nextLabel("mapof_cond");
    const bodyLabel = this.nextLabel("mapof_body");
    const updateLabel = this.nextLabel("mapof_update");
    const endLabel = this.nextLabel("mapof_end");

    this.ctx.emitBr(condLabel);

    this.ctx.emitLabel(condLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexAlloca);
    const condBool = this.ctx.emitIcmp("slt", "i32", currentIndex, lengthI32);
    this.ctx.emitBrCond(condBool, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);

    // inbounds GEP loads stay raw
    const dataFieldPtr = this.nextTemp();
    this.emit(
      `${dataFieldPtr} = getelementptr inbounds %Array, %Array* ${iterableValue}, i32 0, i32 2`,
    );
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataFieldPtr}`);
    const dataCast = this.ctx.emitBitcast(dataPtr, "double*", "i8**");

    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sext i32 ${currentIndex} to i64`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataCast}, i64 ${indexI64}`);
    const entryRaw = this.ctx.emitLoad("i8*", elemPtr);

    const entryPtr = this.ctx.emitBitcast(entryRaw, "i8*", "{ i8*, i8* }*");

    // inbounds GEPs stay raw
    const keySlotPtr = this.nextTemp();
    this.emit(
      `${keySlotPtr} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryPtr}, i32 0, i32 0`,
    );
    const keyVal = this.ctx.emitLoad("i8*", keySlotPtr);
    this.ctx.emitStore("i8*", keyVal, keyAlloca);

    const valueSlotPtr = this.nextTemp();
    this.emit(
      `${valueSlotPtr} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryPtr}, i32 0, i32 1`,
    );
    const valueVal = this.ctx.emitLoad("i8*", valueSlotPtr);
    this.ctx.emitStore("i8*", valueVal, valueAlloca);

    this.loopContinueLabels.push(updateLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(stmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();

    const bodyHasTerminator6 = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator6) {
      this.ctx.emitBr(updateLabel);
    }

    this.ctx.emitLabel(updateLabel);
    const loadedIndex = this.ctx.emitLoad("i32", indexAlloca);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${loadedIndex}, 1`);
    this.ctx.emitStore("i32", nextIndex, indexAlloca);
    this.ctx.emitBr(condLabel);

    this.ctx.emitLabel(endLabel);

    return "0";
  }

  generateSwitchStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "switch") {
      throw new Error("Expected switch statement");
    }

    const switchStmt = stmt as SwitchStatement;
    const endLabel = this.nextLabel("switch_end");

    const discriminantValue = this.ctx.generateExpression(switchStmt.discriminant, params);
    const discriminantType = this.ctx.getVariableType(discriminantValue);
    const isString = discriminantType === "i8*";

    this.loopContinueLabels.push("");
    this.loopBreakLabels.push(endLabel);

    const caseLabels: string[] = [];
    let defaultLabelIndex: number = -1;

    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      if (!caseItem) continue;
      if (caseItem.test === null) {
        defaultLabelIndex = i;
        caseLabels.push(this.nextLabel("case_default"));
      } else {
        caseLabels.push(this.nextLabel("case"));
      }
    }

    const defaultLabel = defaultLabelIndex >= 0 ? caseLabels[defaultLabelIndex] : endLabel;

    let checkLabels: string[] = [];
    let testCaseCount = 0;
    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      if (!caseItem) continue;
      if (caseItem.test !== null) {
        testCaseCount++;
      }
    }

    for (let i = 0; i < testCaseCount; i++) {
      checkLabels.push(this.nextLabel("check"));
    }

    let checkIndex = 0;
    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      if (!caseItem) continue;
      if (caseItem.test !== null) {
        if (checkIndex > 0) {
          this.ctx.emitLabel(checkLabels[checkIndex - 1]);
        }

        const testValue = this.ctx.generateExpression(caseItem.test, params);

        if (isString) {
          const strCmp = this.ctx.emitCall(
            "i32",
            "@strcmp",
            `i8* ${discriminantValue}, i8* ${testValue}`,
          );
          const cmpResult = this.ctx.emitIcmp("eq", "i32", strCmp, "0");
          const nextLabel = checkIndex < testCaseCount - 1 ? checkLabels[checkIndex] : defaultLabel;
          this.ctx.emitBrCond(cmpResult, caseLabels[i], nextLabel);
        } else {
          const dblDiscriminant = this.ctx.ensureDouble(discriminantValue);
          const dblTest = this.ctx.ensureDouble(testValue);
          const cmpResult = this.nextTemp();
          this.emit(`${cmpResult} = fcmp oeq double ${dblDiscriminant}, ${dblTest}`);
          const nextLabel = checkIndex < testCaseCount - 1 ? checkLabels[checkIndex] : defaultLabel;
          this.ctx.emitBrCond(cmpResult, caseLabels[i], nextLabel);
        }
        checkIndex++;
      }
    }

    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      if (!caseItem) continue;
      this.ctx.emitLabel(caseLabels[i]);
      this.ctx.setCurrentLabel(caseLabels[i]);

      for (let j = 0; j < caseItem.consequent.length; j++) {
        const consequentStmt = caseItem.consequent[j];
        if (!consequentStmt) continue;
        if (consequentStmt.type === "break") {
          this.ctx.emitBr(endLabel);
        } else if (
          consequentStmt.type === "variable_declaration" ||
          consequentStmt.type === "return" ||
          consequentStmt.type === "if" ||
          consequentStmt.type === "assignment" ||
          consequentStmt.type === "throw" ||
          consequentStmt.type === "while" ||
          consequentStmt.type === "for" ||
          consequentStmt.type === "for_of" ||
          consequentStmt.type === "continue" ||
          consequentStmt.type === "try" ||
          consequentStmt.type === "switch"
        ) {
          this.ctx.generateBlock({ type: "block", statements: [consequentStmt] }, params);
        } else {
          this.ctx.generateExpression(consequentStmt as Expression, params);
        }
      }

      const lastStmt = caseItem.consequent[caseItem.consequent.length - 1];
      if (
        !lastStmt ||
        (lastStmt.type !== "break" && lastStmt.type !== "return" && lastStmt.type !== "throw")
      ) {
        const nextCaseLabel = i < switchStmt.cases.length - 1 ? caseLabels[i + 1] : endLabel;
        this.ctx.emitBr(nextCaseLabel);
      }
    }

    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();
    this.ctx.emitLabel(endLabel);

    return "0";
  }
}
