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
  CallNode,
} from "../../ast/types.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";
import {
  SymbolKind_Number,
  SymbolKind_String,
  SymbolKind_Object,
  SymbolKind_StringArray,
  SymbolKind_Array,
  SymbolKind_Class,
  ObjectArrayMetadata,
  ObjectMetadata,
  createObjectMetadata,
  createObjectMetadataWithInterface,
  createClassMetadata,
} from "../infrastructure/symbol-table.js";
import type { FieldInfo } from "../infrastructure/type-resolver/types.js";
import { createResolvedType } from "../infrastructure/type-system.js";

interface ExprBase {
  type: string;
}

interface MapValueTypeInfo {
  valueType: string;
  objectMetadata?: ObjectMetadata;
}

export class ForOfGenerator {
  constructor(
    private ctx: IGeneratorContext,
    private loopContinueLabels: string[],
    private loopBreakLabels: string[],
  ) {}

  private nextTemp(): string {
    return this.ctx.nextTemp();
  }
  private nextLabel(prefix: string): string {
    return this.ctx.nextLabel(prefix);
  }
  private emit(instruction: string): void {
    this.ctx.emit(instruction);
  }

  generateForOfStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "for_of") {
      return this.ctx.emitError("Expected for...of statement", stmt.loc);
    }

    const forOfStmt = stmt as ForOfStatement;

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

    const isNonDestructuredEntries =
      !forOfStmt.destructuredNames && this.isMapEntriesCall(forOfStmt.iterable);
    if (isNonDestructuredEntries) {
      return this.ctx.emitError(
        "Map entries() requires destructured iteration: for (const [key, value] of map.entries())",
        stmt.loc,
        "Use destructuring: for (const [key, value] of map.entries()) { ... }",
      );
    }

    const isStringIterable = this.ctx.isStringExpression(forOfStmt.iterable);
    if (isStringIterable) {
      return this.generateStringForOf(stmt as ForOfStatement, params);
    }

    const iterableValue = this.ctx.generateExpression(forOfStmt.iterable, params);

    const isStringArray = this.ctx.isStringArrayExpression(forOfStmt.iterable);
    const isObjectArray = !isStringArray && this.ctx.isObjectArrayExpression(forOfStmt.iterable);
    const isStringSet = this.isStringSetExpression(forOfStmt.iterable);
    let arrayType: string = "";
    let elementType: string = "";
    let elementKind: number = SymbolKind_Number;

    if (isStringSet) {
      arrayType = "%StringSet";
      elementType = "i8*";
      elementKind = SymbolKind_String;
    } else if (isStringArray) {
      arrayType = "%StringArray";
      elementType = "i8*";
      elementKind = SymbolKind_String;
    } else if (isObjectArray) {
      arrayType = "%ObjectArray";
      elementType = "i8*";
      elementKind = SymbolKind_Object;
      const iterableBase = forOfStmt.iterable as ExprBase;
      if (iterableBase.type === "variable") {
        const varName = (forOfStmt.iterable as VariableNode).name;
        const sym = this.ctx.symbolTable.lookup(varName);
        if (sym && sym.resolvedType && sym.resolvedType.arrayDepth > 1) {
          if (sym.resolvedType.base === "string") {
            elementKind = SymbolKind_StringArray;
          } else if (sym.resolvedType.base === "number") {
            elementKind = SymbolKind_Array;
          }
        }
      }
      const classElemType = this.getIterableClassElementType(forOfStmt.iterable);
      if (classElemType) {
        elementKind = SymbolKind_Class;
      }
    } else {
      arrayType = "%Array";
      elementType = "double";
      elementKind = SymbolKind_Number;
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

    let actualElementType = elementType;
    let forOfClassName = "";
    if (elementKind === SymbolKind_StringArray) {
      actualElementType = "%StringArray*";
    } else if (elementKind === SymbolKind_Array && isObjectArray) {
      actualElementType = "%Array*";
    } else if (elementKind === SymbolKind_Class && isObjectArray) {
      forOfClassName = this.getIterableClassElementType(forOfStmt.iterable) || "";
      if (forOfClassName) {
        actualElementType = `%${forOfClassName}_struct*`;
      }
    }

    const elemAlloca = this.ctx.nextAllocaReg(forOfStmt.variableName);
    this.emit(`${elemAlloca} = alloca ${actualElementType}`);

    if (elementKind === SymbolKind_Class && forOfClassName) {
      this.ctx.defineVariableWithMetadata(
        forOfStmt.variableName,
        elemAlloca,
        actualElementType,
        SymbolKind_Class,
        "local",
        createClassMetadata({ className: forOfClassName }),
      );
    } else {
      this.ctx.defineVariable(
        forOfStmt.variableName,
        elemAlloca,
        actualElementType,
        elementKind,
        "local",
      );
    }

    if (elementKind === SymbolKind_StringArray) {
      this.ctx.symbolTable.setResolvedType(
        forOfStmt.variableName,
        createResolvedType("string", { isNullable: false, isOptional: false }, 1),
      );
    } else if (elementKind === SymbolKind_Array && isObjectArray) {
      this.ctx.symbolTable.setResolvedType(
        forOfStmt.variableName,
        createResolvedType("number", { isNullable: false, isOptional: false }, 1),
      );
    }

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

    let storeValue = elemValue;
    if (actualElementType !== elementType) {
      storeValue = this.ctx.emitBitcast(elemValue, elementType, actualElementType);
    }

    this.ctx.emitStore(actualElementType, storeValue, elemAlloca);

    this.loopContinueLabels.push(updateLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(forOfStmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();

    const bodyHasTerminator4 = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator4) {
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

  private generateObjectArrayForOf(
    stmt: Statement,
    params: string[],
    objArrayInfo: ObjectArrayMetadata,
  ): string {
    if (stmt.type !== "for_of") {
      return this.ctx.emitError("Expected for...of statement", stmt.loc);
    }

    const forOfStmt = stmt as ForOfStatement;

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
      SymbolKind_Object,
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

  private generateStringForOf(stmt: ForOfStatement, params: string[]): string {
    const strValue = this.ctx.generateExpression(stmt.iterable, params);

    const strLen = this.ctx.emitCall("i64", "@strlen", `i8* ${strValue}`);
    const lenI32 = this.nextTemp();
    this.emit(`${lenI32} = trunc i64 ${strLen} to i32`);

    const indexAlloca = this.ctx.nextAllocaReg("__forof_idx");
    this.emit(`${indexAlloca} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexAlloca);

    const elemAlloca = this.ctx.nextAllocaReg(stmt.variableName);
    this.emit(`${elemAlloca} = alloca i8*`);
    this.ctx.emitStore("i8*", "null", elemAlloca);

    this.ctx.defineVariable(stmt.variableName, elemAlloca, "i8*", SymbolKind_String, "local");

    const condLabel = this.nextLabel("forof_str_cond");
    const bodyLabel = this.nextLabel("forof_str_body");
    const updateLabel = this.nextLabel("forof_str_update");
    const endLabel = this.nextLabel("forof_str_end");

    this.ctx.emitBr(condLabel);

    this.ctx.emitLabel(condLabel);
    const currentIndex = this.ctx.emitLoad("i32", indexAlloca);
    const condBool = this.ctx.emitIcmp("slt", "i32", currentIndex, lenI32);
    this.ctx.emitBrCond(condBool, bodyLabel, endLabel);

    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);

    const charBuf = this.ctx.emitCall("i8*", "@cs_arena_alloc", "i64 2");
    const idxI64 = this.nextTemp();
    this.emit(`${idxI64} = sext i32 ${currentIndex} to i64`);
    const charPtr = this.nextTemp();
    this.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strValue}, i64 ${idxI64}`);
    const charVal = this.ctx.emitLoad("i8", charPtr);
    this.ctx.emitStore("i8", charVal, charBuf);
    const nullPtr = this.nextTemp();
    this.emit(`${nullPtr} = getelementptr inbounds i8, i8* ${charBuf}, i64 1`);
    this.ctx.emitStore("i8", "0", nullPtr);
    this.ctx.emitStore("i8*", charBuf, elemAlloca);

    this.loopContinueLabels.push(updateLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(stmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();

    const bodyHasTerminator = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator) {
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
        const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
        if (!mapMeta || mapMeta.keyType !== "string") {
          return this.ctx.emitError(
            "for...of on Map<number, *> is not supported — use Map<string, *> instead",
            stmt.loc,
          );
        }
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
          if (fieldInfo.tsType.startsWith("Map<number")) {
            return this.ctx.emitError(
              "for...of on Map<number, *> is not supported — use Map<string, *> instead",
              stmt.loc,
            );
          }
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
    this.emit(
      `${lenPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${iterableValue}, i32 0, i32 1`,
    );
    const lengthI32 = this.ctx.emitLoad("i32", lenPtr);

    const indexAlloca = this.ctx.nextAllocaReg("__forof_idx");
    this.emit(`${indexAlloca} = alloca i32`);
    this.ctx.emitStore("i32", "0", indexAlloca);

    const keyAlloca = this.ctx.nextAllocaReg(keyName);
    this.emit(`${keyAlloca} = alloca i8*`);
    const valueAlloca = this.ctx.nextAllocaReg(valueName);
    this.emit(`${valueAlloca} = alloca i8*`);

    this.ctx.defineVariable(keyName, keyAlloca, "i8*", SymbolKind_String, "local");

    if (valueTypeInfo) {
      const vti = valueTypeInfo as MapValueTypeInfo;
      if (vti.objectMetadata) {
        this.ctx.defineVariableWithMetadata(
          valueName,
          valueAlloca,
          "i8*",
          SymbolKind_Object,
          "local",
          createObjectMetadata(vti.objectMetadata),
        );
      } else if (
        vti.valueType &&
        vti.valueType !== "string" &&
        vti.valueType !== "number" &&
        this.ctx.classGenGetClassFields(vti.valueType).length > 0
      ) {
        this.ctx.defineVariableWithMetadata(
          valueName,
          valueAlloca,
          "i8*",
          SymbolKind_Class,
          "local",
          createClassMetadata({ className: vti.valueType }),
        );
      } else {
        this.ctx.defineVariable(valueName, valueAlloca, "i8*", SymbolKind_String, "local");
      }
    } else {
      this.ctx.defineVariable(valueName, valueAlloca, "i8*", SymbolKind_String, "local");
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

    const dataFieldPtr = this.nextTemp();
    this.emit(
      `${dataFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${iterableValue}, i32 0, i32 0`,
    );
    const dataRaw = this.ctx.emitLoad("i8*", dataFieldPtr);
    const dataCast = this.ctx.emitBitcast(dataRaw, "i8*", "i8**");

    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sext i32 ${currentIndex} to i64`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataCast}, i64 ${indexI64}`);
    const entryRaw = this.ctx.emitLoad("i8*", elemPtr);

    const entryPtr = this.ctx.emitBitcast(entryRaw, "i8*", "{ i8*, i8* }*");

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
          const f = fRaw as InterfaceField;
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
        const f = fRaw as InterfaceField;
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
      const f = fRaw as InterfaceField;
      if (!f.name) continue;
      if (f.name === fieldName) {
        return f.type;
      }
    }
    return null;
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
      if (memberAccessObjBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldTsType = this.ctx.classGenGetFieldTsType(className, memberAccess.property);
          if (fieldTsType && fieldTsType.endsWith("[]")) {
            const elementTypeName = fieldTsType.slice(0, -2).trim();
            const elemIface = this.ctx.getInterfaceFromAST(elementTypeName);
            if (elemIface) {
              const elemIfaceTyped = elemIface as InterfaceDeclaration;
              const allFields = this.ctx.getAllInterfaceFields(elemIfaceTyped);
              const elementKeys: string[] = [];
              const elementTypes: string[] = [];
              const elementTsTypes: string[] = [];
              for (let i = 0; i < allFields.length; i++) {
                const fRaw = allFields[i];
                if (!fRaw) continue;
                const f = fRaw as InterfaceField;
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
                  const f = fRaw as InterfaceField;
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
                const f = fields[i] as InterfaceField;
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
                const f = fRaw as InterfaceField;
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

    if (iterable.type === "call") {
      const callNode = iterable as CallNode;
      const ast = this.ctx.getAst();
      if (ast && ast.functions) {
        for (let fi = 0; fi < ast.functions.length; fi++) {
          const func = ast.functions[fi];
          if (!func || func.name !== callNode.name) continue;
          const retType = func.returnType;
          if (retType && retType.endsWith("[]")) {
            const elementTypeName = retType.slice(0, -2).trim();
            const elemIface = this.ctx.getInterfaceFromAST(elementTypeName);
            if (elemIface) {
              const elemIfaceTyped = elemIface as InterfaceDeclaration;
              const allFields = this.ctx.getAllInterfaceFields(elemIfaceTyped);
              const elementKeys: string[] = [];
              const elementTypes: string[] = [];
              const elementTsTypes: string[] = [];
              for (let ffi = 0; ffi < allFields.length; ffi++) {
                const fRaw = allFields[ffi];
                if (!fRaw) continue;
                const f = fRaw as InterfaceField;
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
          break;
        }
      }
    }

    if (iterable.type === "variable") {
      const varName = (iterable as VariableNode).name;
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return objArrayMeta;
      }
      // Fallback: when the allocator stored rawInterfaceType but didn't populate
      // ObjectArrayMetadata (happens for `const arr: Pt[] = [...]` paths where
      // classification routed through DeclaredInterface rather than ObjectArray),
      // synthesize the metadata from the element interface declaration. Without
      // this fallback, for-of doesn't set interface metadata on `p`, and
      // member-access on `p` falls through to opaque struct reads — fuzz g14.
      const rawIface = this.ctx.symbolTable.getRawInterfaceType(varName);
      if (rawIface && rawIface.length > 0) {
        const elemIface = this.ctx.getInterfaceFromAST(rawIface);
        if (elemIface) {
          const elemIfaceTyped = elemIface as InterfaceDeclaration;
          const allFields = this.ctx.getAllInterfaceFields(elemIfaceTyped);
          const elementKeys: string[] = [];
          const elementTypes: string[] = [];
          const elementTsTypes: string[] = [];
          for (let i = 0; i < allFields.length; i++) {
            const fRaw = allFields[i];
            if (!fRaw) continue;
            const f = fRaw as InterfaceField;
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
            elementInterfaceName: rawIface,
            elementKeys,
            elementTypes,
            elementTsTypes,
          };
        }
      }
    }

    return null;
  }

  private getIterableClassElementType(iterable: Expression): string | null {
    const iterBase = iterable as ExprBase;
    if (iterBase.type === "variable") {
      const varName = (iterable as VariableNode).name;
      const rawElemType = this.ctx.symbolTable.getRawInterfaceType(varName);
      if (rawElemType && this.ctx.classGenGetClassFields(rawElemType).length > 0) {
        return rawElemType;
      }
    }
    if (iterBase.type === "call") {
      const callNode = iterable as CallNode;
      const ast = this.ctx.getAst();
      if (ast && ast.functions) {
        for (let i = 0; i < ast.functions.length; i++) {
          const func = ast.functions[i];
          if (!func || func.name !== callNode.name) continue;
          const retType = func.returnType;
          if (retType && retType.endsWith("[]")) {
            const elemName = retType.slice(0, -2).trim();
            if (this.ctx.classGenGetClassFields(elemName).length > 0) {
              return elemName;
            }
          }
        }
      }
    }
    if (iterBase.type === "member_access") {
      const ma = iterable as MemberAccessNode;
      const objBase = ma.object as ExprBase;
      let ownerClassName: string | null = null;
      if (objBase.type === "this") {
        ownerClassName = this.ctx.getCurrentClassName() || null;
      } else if (objBase.type === "variable") {
        const objName = (ma.object as VariableNode).name;
        const cm = this.ctx.symbolTable.getClassMetadata(objName);
        if (cm) ownerClassName = cm.className;
      }
      if (ownerClassName) {
        const fieldTsType = this.ctx.classGenGetFieldTsType(ownerClassName, ma.property);
        if (fieldTsType && fieldTsType.endsWith("[]")) {
          const elemName = fieldTsType.slice(0, -2).trim();
          if (this.ctx.classGenGetClassFields(elemName).length > 0) {
            return elemName;
          }
        }
      }
    }
    if (iterBase.type === "method_call") {
      const mcNode = iterable as MethodCallNode;
      const mcMethod = mcNode.method;
      if (
        mcMethod === "filter" ||
        mcMethod === "sort" ||
        mcMethod === "reverse" ||
        mcMethod === "slice"
      ) {
        const sourceElemType = this.getIterableClassElementType(mcNode.object);
        if (sourceElemType) return sourceElemType;
      }
      const objBase = mcNode.object as ExprBase;
      if (objBase.type === "variable") {
        const objName = (mcNode.object as VariableNode).name;
        const classMeta = this.ctx.symbolTable.getClassMetadata(objName);
        if (classMeta) {
          const className = classMeta.className;
          const ast = this.ctx.getAst();
          if (ast && ast.classes) {
            for (let i = 0; i < ast.classes.length; i++) {
              const cls = ast.classes[i];
              if (!cls || cls.name !== className) continue;
              for (let j = 0; j < cls.methods.length; j++) {
                const method = cls.methods[j];
                if (!method || method.name !== mcNode.method) continue;
                const retType = method.returnType;
                if (retType && retType.endsWith("[]")) {
                  const elemName = retType.slice(0, -2).trim();
                  if (this.ctx.classGenGetClassFields(elemName).length > 0) {
                    return elemName;
                  }
                }
              }
            }
          }
        }
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
          const f = fRaw as InterfaceField;
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
      const f = fRaw as InterfaceField;
      if (!f.name) continue;
      const fieldName = f.name.replace("?", "");
      if (fieldName === propName) {
        fieldDefResult = f as InterfaceField;
        break;
      }
    }
    const fieldDef = fieldDefResult as InterfaceField;
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
          const f = fRaw as InterfaceField;
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
        const f = elementAllFields[i] as InterfaceField;
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
          const f = fRaw as InterfaceField;
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
        const f = elementAllFields[i] as InterfaceField;
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
      const f = firstInterfaceAllFields[i] as InterfaceField;
      firstFields.set(f.name, f.type);
    }

    const commonFields: CommonField[] = [];
    for (let _ffi = 0; _ffi < firstInterfaceAllFields.length; _ffi++) {
      const firstField = firstInterfaceAllFields[_ffi] as InterfaceField;
      const fieldName = firstField.name;
      const fieldType = firstField.type;
      let isCommon = true;
      let resolvedType = fieldType;
      for (let i = 1; i < memberInterfaces.length; i++) {
        const otherIface = memberInterfaces[i];
        const otherAllFields = this.ctx.getAllInterfaceFields(otherIface);
        let otherFieldResult: InterfaceField | null = null;
        for (let j = 0; j < otherAllFields.length; j++) {
          const f = otherAllFields[j] as InterfaceField;
          if (f.name === fieldName) {
            otherFieldResult = f;
            break;
          }
        }
        const otherField = otherFieldResult as InterfaceField;
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
  ): MapValueTypeInfo | null {
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
}
