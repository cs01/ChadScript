import {
  AST,
  InterfaceDeclaration,
  InterfaceField,
  TypeAliasDeclaration,
  Expression,
  MemberAccessNode,
  VariableNode,
  IndexAccessNode,
  BinaryNode,
  FunctionNode,
  ClassNode,
  CommonField,
  FunctionParameter,
  MethodCallNode,
  StringNode,
} from "../../../ast/types.js";
import {
  SymbolTable,
  ObjectMetadata,
  SymbolKind,
  Symbol as SymbolEntry,
  MapMetadata,
  ObjectArrayMetadata,
} from "../symbol-table.js";
import type { TypeChecker } from "../../../typescript/type-checker.js";
import {
  FieldInfo,
  MapTypeInfo,
  SetTypeInfo,
  TypeGuardInfo,
  UnionCommonFields,
  ThisFieldMapInfo,
  ThisFieldSetInfo,
} from "./types.js";
import {
  ResolvedType,
  createResolvedType,
  parseTypeString,
  stripOptional,
  parseMapTypeString,
  parseSetTypeString,
  parseArrayTypeString,
  canonicalTypeToLlvm,
} from "../type-system.js";

interface ExprBase {
  type: string;
}

export interface TypeResolverContext {
  ast?: AST;
  getAst(): AST | undefined;
  getAstInterfacesLength(): number;
  getAstInterfaceAt(index: number): InterfaceDeclaration | null;
  getAstInterfaceNameAt(index: number): string | null;
  getAstFunctionsLength(): number;
  getAstFunctionAt(index: number): FunctionNode | null;
  getAstFunctionNameAt(index: number): string | null;
  getAstClassesLength(): number;
  getAstClassAt(index: number): ClassNode | null;
  getAstClassNameAt(index: number): string | null;
  symbolTable: SymbolTable;
  typeChecker?: TypeChecker | null;
  currentClassName?: string | null;
  getCurrentClassName(): string | null;
  currentFunction?: string | null;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  hasClassGen(): boolean;
}

interface BuiltinAstType {
  name: string;
  fields: { name: string; type: string }[];
}

function getDiscriminantAssignVarReturn(discriminant: string): BuiltinAstType | null {
  if (discriminant === "assignment") {
    return {
      name: "AssignmentStatement",
      fields: [
        { name: "type", type: "'assignment'" },
        { name: "name", type: "string" },
        { name: "value", type: "Expression" },
      ],
    };
  }
  if (discriminant === "variable_declaration") {
    return {
      name: "VariableDeclaration",
      fields: [
        { name: "type", type: "'variable_declaration'" },
        { name: "kind", type: "'let' | 'const'" },
        { name: "name", type: "string" },
        { name: "value", type: "Expression | null" },
        { name: "declaredType", type: "string" },
      ],
    };
  }
  if (discriminant === "return") {
    return {
      name: "ReturnStatement",
      fields: [
        { name: "type", type: "'return'" },
        { name: "value", type: "Expression" },
      ],
    };
  }
  if (discriminant === "if") {
    return {
      name: "IfStatement",
      fields: [
        { name: "type", type: "'if'" },
        { name: "condition", type: "Expression" },
        { name: "thenBlock", type: "BlockStatement" },
        { name: "elseBlock", type: "BlockStatement | null" },
      ],
    };
  }
  return null;
}

function getDiscriminantLoopBlock(discriminant: string): BuiltinAstType | null {
  if (discriminant === "while") {
    return {
      name: "WhileStatement",
      fields: [
        { name: "type", type: "'while'" },
        { name: "condition", type: "Expression" },
        { name: "body", type: "BlockStatement" },
      ],
    };
  }
  if (discriminant === "for") {
    return {
      name: "ForStatement",
      fields: [
        { name: "type", type: "'for'" },
        { name: "init", type: "VariableDeclaration | AssignmentStatement | null" },
        { name: "condition", type: "Expression | null" },
        { name: "update", type: "AssignmentStatement | null" },
        { name: "body", type: "BlockStatement" },
      ],
    };
  }
  if (discriminant === "for_of") {
    return {
      name: "ForOfStatement",
      fields: [
        { name: "type", type: "'for_of'" },
        { name: "variableKind", type: "'let' | 'const' | 'var'" },
        { name: "variableName", type: "string" },
        { name: "iterable", type: "Expression" },
        { name: "body", type: "BlockStatement" },
      ],
    };
  }
  if (discriminant === "block") {
    return {
      name: "BlockStatement",
      fields: [
        { name: "type", type: "'block'" },
        { name: "statements", type: "Statement[]" },
      ],
    };
  }
  return null;
}

function getDiscriminantErrorHandler(discriminant: string): BuiltinAstType | null {
  if (discriminant === "throw") {
    return {
      name: "ThrowStatement",
      fields: [
        { name: "type", type: "'throw'" },
        { name: "argument", type: "Expression" },
      ],
    };
  }
  if (discriminant === "try") {
    return {
      name: "TryStatement",
      fields: [
        { name: "type", type: "'try'" },
        { name: "block", type: "BlockStatement" },
        { name: "handler", type: "CatchClause | null" },
        { name: "finalizer", type: "BlockStatement | null" },
      ],
    };
  }
  if (discriminant === "switch") {
    return {
      name: "SwitchStatement",
      fields: [
        { name: "type", type: "'switch'" },
        { name: "discriminant", type: "Expression" },
        { name: "cases", type: "SwitchCase[]" },
      ],
    };
  }
  if (discriminant === "break") {
    return {
      name: "BreakStatement",
      fields: [{ name: "type", type: "'break'" }],
    };
  }
  return null;
}

function getBuiltinAstTypeByDiscriminant(discriminant: string): BuiltinAstType | null {
  const avr = getDiscriminantAssignVarReturn(discriminant);
  if (avr) return avr;
  const lb = getDiscriminantLoopBlock(discriminant);
  if (lb) return lb;
  const eh = getDiscriminantErrorHandler(discriminant);
  if (eh) return eh;
  if (discriminant === "continue") {
    return {
      name: "ContinueStatement",
      fields: [{ name: "type", type: "'continue'" }],
    };
  }
  return null;
}

function getBuiltinAstTypeGroup1(name: string): BuiltinAstType | null {
  if (name === "AssignmentStatement") return getBuiltinAstTypeByDiscriminant("assignment");
  if (name === "VariableDeclaration")
    return getBuiltinAstTypeByDiscriminant("variable_declaration");
  if (name === "ReturnStatement") return getBuiltinAstTypeByDiscriminant("return");
  if (name === "IfStatement") return getBuiltinAstTypeByDiscriminant("if");
  return null;
}

function getBuiltinAstTypeGroup2(name: string): BuiltinAstType | null {
  if (name === "WhileStatement") return getBuiltinAstTypeByDiscriminant("while");
  if (name === "ForStatement") return getBuiltinAstTypeByDiscriminant("for");
  if (name === "ForOfStatement") return getBuiltinAstTypeByDiscriminant("for_of");
  if (name === "BlockStatement") return getBuiltinAstTypeByDiscriminant("block");
  return null;
}

function getBuiltinAstTypeGroup3(name: string): BuiltinAstType | null {
  if (name === "ThrowStatement") return getBuiltinAstTypeByDiscriminant("throw");
  if (name === "TryStatement") return getBuiltinAstTypeByDiscriminant("try");
  if (name === "SwitchStatement") return getBuiltinAstTypeByDiscriminant("switch");
  if (name === "BreakStatement") return getBuiltinAstTypeByDiscriminant("break");
  return null;
}

function getBuiltinAstTypeByName(name: string): BuiltinAstType | null {
  const g1 = getBuiltinAstTypeGroup1(name);
  if (g1) return g1;
  const g2 = getBuiltinAstTypeGroup2(name);
  if (g2) return g2;
  const g3 = getBuiltinAstTypeGroup3(name);
  if (g3) return g3;
  if (name === "ContinueStatement") return getBuiltinAstTypeByDiscriminant("continue");
  return null;
}

export class TypeResolver {
  constructor(private ctx: TypeResolverContext) {}

  clearCaches(): void {}

  getCompleteType(name: string): ResolvedType | null {
    const cached = this.ctx.symbolTable.getResolvedType(name);
    if (cached) return cached;

    let resolved: ResolvedType | null = null;

    const ifaceType = this.ctx.symbolTable.getInterfaceType(name);
    if (ifaceType) {
      resolved = parseTypeString(ifaceType);
    }
    if (!resolved) {
      const mapMeta = this.ctx.symbolTable.getMapMetadata(name);
      if (mapMeta) {
        const keyType = parseTypeString(mapMeta.keyType);
        const valueType = parseTypeString(mapMeta.valueType);
        resolved = createResolvedType("Map", {}, 0, [keyType, valueType]);
      }
    }
    if (!resolved) {
      const setValueType = this.ctx.symbolTable.getSetValueType(name);
      if (setValueType) {
        const valueType = parseTypeString(setValueType);
        resolved = createResolvedType("Set", {}, 0, [valueType]);
      }
    }
    if (!resolved) {
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(name);
      if (objArrayMeta) {
        resolved = createResolvedType(objArrayMeta.elementInterfaceName, {}, 1);
      }
    }
    if (!resolved) {
      const arrMetaElementType = this.ctx.symbolTable.getArrayMetadataElementType(name);
      if (arrMetaElementType) {
        resolved = createResolvedType(arrMetaElementType, {}, 1);
      }
    }
    if (!resolved && this.ctx.symbolTable.isStringArray(name)) {
      resolved = createResolvedType("string", {}, 1);
    }
    if (!resolved && this.ctx.symbolTable.isBooleanArray(name)) {
      resolved = createResolvedType("boolean", {}, 1);
    }
    if (!resolved) {
      const className = this.ctx.symbolTable.getClassName(name);
      if (className) {
        resolved = createResolvedType(className);
      }
    }
    if (!resolved) {
      const llvmType = this.ctx.symbolTable.getType(name);
      if (llvmType) {
        switch (llvmType) {
          case "double":
            resolved = createResolvedType("number");
            break;
          case "i8*":
            resolved = createResolvedType("string");
            break;
          case "i1":
            resolved = createResolvedType("boolean");
            break;
          case "%Array*":
            resolved = createResolvedType("number", {}, 1);
            break;
          case "%StringArray*":
            resolved = createResolvedType("string", {}, 1);
            break;
          case "%Map*":
            resolved = createResolvedType("Map");
            break;
          case "%StringMap*":
            resolved = createResolvedType("Map", {}, 0, [
              createResolvedType("string"),
              createResolvedType("unknown"),
            ]);
            break;
          case "%Set*":
            resolved = createResolvedType("Set");
            break;
          case "%StringSet*":
            resolved = createResolvedType("Set", {}, 0, [createResolvedType("string")]);
            break;
          default:
            if (llvmType.startsWith("%") && llvmType.endsWith("*")) {
              const typeName = llvmType.slice(1, -1);
              if (typeName.endsWith("_struct")) {
                resolved = createResolvedType(typeName.slice(0, -7));
              } else {
                resolved = createResolvedType(typeName);
              }
            }
            break;
        }
      }
    }

    if (resolved) {
      this.ctx.symbolTable.setResolvedType(name, resolved);
    }

    return resolved;
  }

  private getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[] {
    const result: InterfaceField[] = [];
    if (iface.extends && iface.extends.length > 0) {
      for (let i = 0; i < iface.extends.length; i++) {
        const parentName = iface.extends[i];
        const parent = this.getInterface(parentName);
        if (parent) {
          const parentFields = this.getAllInterfaceFields(parent);
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

  getInterface(name: string): InterfaceDeclaration | null {
    if (!name) {
      return null;
    }
    const builtinType = getBuiltinAstTypeByName(name);
    if (builtinType) {
      const fields: InterfaceField[] = [];
      for (let i = 0; i < builtinType.fields.length; i++) {
        const f = builtinType.fields[i];
        fields.push({ name: f.name, type: f.type });
      }
      const ifaceDecl: InterfaceDeclaration = {
        name: builtinType.name,
        fields: fields,
        extends: [],
      };
      return ifaceDecl;
    }
    const interfacesLen = this.ctx.getAstInterfacesLength();
    if (interfacesLen === 0) {
      return null;
    }
    for (let i = 0; i < interfacesLen; i++) {
      const ifaceName = this.ctx.getAstInterfaceNameAt(i);
      if (!ifaceName) {
        continue;
      }
      if (ifaceName === name) {
        const iface = this.ctx.getAstInterfaceAt(i);
        return iface;
      }
    }
    return null;
  }

  getInterfaceMetadata(name: string): ObjectMetadata | null {
    const builtinType = getBuiltinAstTypeByName(name);
    if (builtinType) {
      const keys: string[] = [];
      const types: string[] = [];
      const tsTypes: string[] = [];
      for (let i = 0; i < builtinType.fields.length; i++) {
        const f = builtinType.fields[i];
        keys.push(stripOptional(f.name));
        types.push(canonicalTypeToLlvm(f.type, "default", this.isEnumType(f.type), false, ""));
        tsTypes.push(f.type);
      }
      return { keys, types, tsTypes };
    }

    const iface = this.getInterface(name);
    if (!iface) return null;
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    const allFields = this.getAllInterfaceFields(iface);
    for (let i = 0; i < allFields.length; i++) {
      const f = allFields[i] as { name: string; type: string };
      keys.push(stripOptional(f.name));
      types.push(canonicalTypeToLlvm(f.type, "default", this.isEnumType(f.type), false, ""));
      tsTypes.push(f.type);
    }
    return { keys, types, tsTypes };
  }

  getInterfaceProperty(interfaceName: string, propName: string): InterfaceField | null {
    if (!interfaceName || !propName) {
      return null;
    }
    const iface = this.getInterface(interfaceName);
    if (!iface) return null;
    const allFields = this.getAllInterfaceFields(iface);
    for (let i = 0; i < allFields.length; i++) {
      const f = allFields[i] as { name: string; type: string };
      if (!f || !f.name) {
        continue;
      }
      if (f.name === propName) {
        return f;
      }
    }
    return null;
  }

  getInterfaceDefinition(
    interfaceName: string,
  ): { properties: { name: string; type: string }[] } | null {
    const iface = this.getInterface(interfaceName);
    if (!iface) return null;
    const properties: { name: string; type: string }[] = [];
    const allFields = this.getAllInterfaceFields(iface);
    for (let i = 0; i < allFields.length; i++) {
      const f = allFields[i] as { name: string; type: string };
      properties.push({ name: f.name, type: f.type });
    }
    return { properties };
  }

  private resolveMemberAccessArrayType(memberAccess: MemberAccessNode): string | null {
    const objectType = this.resolveMemberAccessObjectType(memberAccess.object);
    if (!objectType) return null;

    const fieldProp = this.getInterfaceProperty(objectType, memberAccess.property);
    if (!fieldProp) return null;

    const arrayParsed = parseArrayTypeString(fieldProp.type);
    if (!arrayParsed) return null;

    return arrayParsed.elementType;
  }

  private resolveMemberAccessObjectType(expr: Expression): string | null {
    const exprBase = expr as ExprBase;
    if (exprBase.type === "this") {
      return this.ctx.getCurrentClassName() || null;
    }
    if (exprBase.type === "member_access") {
      const member = expr as MemberAccessNode;
      const memberObjBase = member.object as ExprBase;
      if (memberObjBase.type === "this") {
        if (this.ctx.getCurrentClassName() && this.ctx.hasClassGen()) {
          const fieldInfoResult = this.ctx.classGenGetFieldInfo(
            this.ctx.getCurrentClassName()!,
            member.property,
          );
          const fieldInfo = fieldInfoResult as FieldInfo;
          if (fieldInfoResult && fieldInfo.tsType) {
            return fieldInfo.tsType;
          }
        }
        return null;
      }
      const objectType = this.resolveMemberAccessObjectType(member.object);
      if (objectType) {
        const fieldProp = this.getInterfaceProperty(objectType, member.property);
        if (fieldProp) {
          return fieldProp.type;
        }
      }
    }
    return null;
  }

  getTypeAlias(name: string): TypeAliasDeclaration | null {
    if (!name) return null;
    const ast = this.ctx.getAst();
    if (!ast || !ast.typeAliases) return null;
    for (let i = 0; i < ast.typeAliases.length; i++) {
      const ta = ast.typeAliases[i] as TypeAliasDeclaration;
      if (!ta || !ta.name) {
        continue;
      }
      if (ta.name === name) {
        return ta;
      }
    }
    return null;
  }

  getFunction(name: string): FunctionNode | null {
    if (!name) return null;
    const functionsLen = this.ctx.getAstFunctionsLength();
    for (let i = 0; i < functionsLen; i++) {
      const fn = this.ctx.getAstFunctionAt(i);
      if (!fn || !fn.name) {
        continue;
      }
      if (fn.name === name) {
        return fn;
      }
    }
    return null;
  }

  getFunctionType(
    functionName: string,
  ): { parameters: { name: string; type: string }[]; returnType: string } | null {
    const func = this.getFunction(functionName);
    if (!func) return null;
    const parameters: { name: string; type: string }[] = [];
    if (func.parameters) {
      for (let i = 0; i < func.parameters.length; i++) {
        const p = func.parameters[i] as FunctionParameter;
        parameters.push({
          name: p.name,
          type: p.type || "number",
        });
      }
    } else if (func.params && func.paramTypes) {
      for (let i = 0; i < func.params.length; i++) {
        parameters.push({
          name: func.params[i],
          type: func.paramTypes[i] || "number",
        });
      }
    }
    return { parameters, returnType: func.returnType || "void" };
  }

  getClass(name: string): ClassNode | null {
    if (!name) {
      return null;
    }
    const classesLen = this.ctx.getAstClassesLength();
    if (classesLen === 0) {
      return null;
    }
    for (let i = 0; i < classesLen; i++) {
      const cls = this.ctx.getAstClassAt(i);
      if (!cls || !cls.name) {
        continue;
      }
      if (cls.name === name) {
        return cls;
      }
    }
    return null;
  }

  getUnionCommonFields(memberNames: string[]): UnionCommonFields {
    const interfaces: InterfaceDeclaration[] = [];
    for (let i = 0; i < memberNames.length; i++) {
      const iface = this.getInterface(memberNames[i]);
      if (iface !== null) {
        interfaces.push(iface);
      }
    }

    if (interfaces.length === 0) {
      return { keys: [], types: [], tsTypes: [] };
    }

    const firstInterface = interfaces[0] as InterfaceDeclaration;
    const firstFields = this.getAllInterfaceFields(firstInterface);
    const commonFields: CommonField[] = [];

    for (let fi = 0; fi < firstFields.length; fi++) {
      const field = firstFields[fi] as { name: string; type: string };
      let isCommon = true;
      for (let ii = 0; ii < interfaces.length; ii++) {
        const iface = interfaces[ii] as InterfaceDeclaration;
        const ifaceFields = this.getAllInterfaceFields(iface);
        let hasMatch = false;
        for (let jj = 0; jj < ifaceFields.length; jj++) {
          const f = ifaceFields[jj] as { name: string; type: string };
          if (f.name === field.name && this.areTypesCompatible(f.type, field.type)) {
            hasMatch = true;
            break;
          }
        }
        if (!hasMatch) {
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
      types.push(canonicalTypeToLlvm(f.type, "default", this.isEnumType(f.type), false, ""));
      tsTypes.push(f.type);
    }
    return { keys, types, tsTypes };
  }

  getClassFieldInfo(className: string, fieldName: string): FieldInfo | null {
    return this.ctx.classGenGetFieldInfo(className, fieldName);
  }

  getClassFieldMapType(className: string, fieldName: string): MapTypeInfo | null {
    const fieldInfoResult = this.getClassFieldInfo(className, fieldName);
    const fieldInfo = fieldInfoResult as FieldInfo;
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const mapParsed = parseMapTypeString(fieldInfo.tsType);
    if (!mapParsed) return null;

    const keyType = mapParsed.keyType as "string" | "number";
    const valueType = mapParsed.valueType;

    return {
      keyType,
      valueType,
      llvmKeyType: keyType === "string" ? "i8*" : "double",
      llvmValueType: canonicalTypeToLlvm(
        valueType,
        "default",
        this.isEnumType(valueType),
        false,
        "",
      ),
    };
  }

  getClassFieldSetType(className: string, fieldName: string): SetTypeInfo | null {
    const fieldInfoResult = this.getClassFieldInfo(className, fieldName);
    const fieldInfo = fieldInfoResult as FieldInfo;
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const setParsed = parseSetTypeString(fieldInfo.tsType);
    if (!setParsed) return null;

    const valueType = setParsed.valueType as "string" | "number";

    return {
      valueType,
      llvmValueType: valueType === "string" ? "i8*" : "double",
    };
  }

  getMapGetInterfaceType(expr: Expression): string | null {
    if (!expr || expr.type !== "method_call") return null;
    const methodCall = expr as MethodCallNode;
    if (methodCall.method !== "get") return null;

    let valueType: string | null = null;

    if (methodCall.object && methodCall.object.type === "variable") {
      const mapName = (methodCall.object as VariableNode).name;
      if (!this.ctx.symbolTable.isMap(mapName)) return null;

      const mapMeta = this.ctx.symbolTable.getMapMetadata(mapName);
      if (!mapMeta) return null;
      if (mapMeta.keyType !== "string") return null;

      valueType = mapMeta.valueType;
    } else if (methodCall.object && methodCall.object.type === "member_access") {
      const memberExpr = methodCall.object as MemberAccessNode;
      const memberExprObjBase = memberExpr.object as ExprBase;
      if (memberExprObjBase.type !== "this") return null;
      const className = this.ctx.getCurrentClassName();
      if (!className) return null;

      const mapType = this.getClassFieldMapType(className, memberExpr.property);
      if (!mapType) return null;
      if (mapType.keyType !== "string") return null;

      valueType = mapType.valueType;
    }

    if (!valueType) return null;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") return null;

    if (valueType.endsWith("[]")) {
      return valueType;
    }

    const interfaceDef = this.getInterface(valueType);
    if (!interfaceDef) return null;

    return valueType;
  }

  resolveIndexedAccessType(expr: IndexAccessNode): ObjectMetadata | null {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "member_access") return null;

    const memberAccess = expr.object as MemberAccessNode;
    const propertyName = memberAccess.property;

    let objectInfo:
      | { ptr: string; keys: string[]; types: string[]; tsTypes?: string[] }
      | undefined;

    const memberAccessObjBase = memberAccess.object as ExprBase;
    if (memberAccessObjBase.type === "variable") {
      const varName = (memberAccess.object as VariableNode).name;
      objectInfo = this.ctx.symbolTable.getObjectInfo(varName);
    }

    if (!objectInfo) return null;

    const propIndex = objectInfo.keys.indexOf(propertyName);
    if (propIndex === -1) return null;

    const tsTypesArr = objectInfo.tsTypes as string[];
    const propTsType = tsTypesArr[propIndex];
    if (!propTsType) return null;

    const arrayParsed = parseArrayTypeString(propTsType);
    if (!arrayParsed) return null;

    const elementType = arrayParsed.elementType;
    return this.getInterfaceMetadata(elementType);
  }

  detectTypeGuard(condition: Expression): TypeGuardInfo | null {
    if (!condition) return null;
    if (condition.type !== "binary") return null;

    const binary = condition as BinaryNode;
    if (binary.op !== "===" && binary.op !== "==") return null;
    if (!binary.left || !binary.right) return null;

    const leftBase = binary.left as ExprBase;
    const rightBase = binary.right as ExprBase;
    if (!leftBase.type || !rightBase.type) return null;

    let memberAccessVar: MemberAccessNode | null = null;
    let literalValueVar: string | null = null;

    if (leftBase.type === "member_access" && rightBase.type === "string") {
      memberAccessVar = binary.left as MemberAccessNode;
      const stringNode = binary.right as StringNode;
      literalValueVar = stringNode.value;
    } else if (rightBase.type === "member_access" && leftBase.type === "string") {
      memberAccessVar = binary.right as MemberAccessNode;
      const stringNode = binary.left as StringNode;
      literalValueVar = stringNode.value;
    }

    if (!memberAccessVar || !literalValueVar) return null;
    const memberAccess = memberAccessVar as MemberAccessNode;
    const literalValue = literalValueVar as string;
    if (memberAccess.property !== "type") return null;
    const memberAccessObjBase2 = memberAccess.object as ExprBase;
    if (memberAccessObjBase2.type !== "variable") return null;

    const varName = (memberAccess.object as VariableNode).name;
    const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
    if (!objMeta) return null;

    const interfaceName = this.findInterfaceByDiscriminant(literalValue);
    if (!interfaceName) return null;

    const metadata = this.getInterfaceMetadata(interfaceName);
    if (!metadata) return null;

    const currentKeys = objMeta.keys;
    let isSubset = true;
    for (let ki = 0; ki < metadata.keys.length; ki++) {
      if (currentKeys.indexOf(metadata.keys[ki]) === -1) {
        isSubset = false;
        break;
      }
    }
    if (!isSubset) return null;

    return {
      varName,
      narrowedMetadata: metadata,
    };
  }

  findInterfaceByDiscriminant(value: string, field: string = "type"): string | null {
    if (field === "type") {
      const builtinType = getBuiltinAstTypeByDiscriminant(value);
      if (builtinType) {
        return builtinType.name;
      }
    }

    const interfacesLen = this.ctx.getAstInterfacesLength();
    for (let i = 0; i < interfacesLen; i++) {
      const ifaceName = this.ctx.getAstInterfaceNameAt(i);
      if (!ifaceName) continue;
      const iface = this.ctx.getAstInterfaceAt(i);
      if (!iface) continue;
      const match = this.checkInterfaceForDiscriminant(
        ifaceName,
        this.getAllInterfaceFields(iface),
        value,
        field,
      );
      if (match) return match;
    }
    return null;
  }

  private checkInterfaceForDiscriminant(
    ifaceName: string,
    fields: InterfaceField[],
    value: string,
    field: string,
  ): string | null {
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; type: string };
      if (f.name === field) {
        if (f.type === `'${value}'` || f.type === `"${value}"`) {
          return ifaceName;
        }
      }
    }
    return null;
  }

  areTypesCompatible(type1: string, type2: string): boolean {
    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  normalizeType(typeStr: string): string {
    if (typeStr.startsWith("'") && typeStr.endsWith("'")) return "string";
    if (typeStr.startsWith('"') && typeStr.endsWith('"')) return "string";
    return typeStr;
  }

  isEnumType(typeName: string): boolean {
    const ast = this.ctx.getAst();
    if (!ast || !ast.enums) return false;
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
    for (let i = 0; i < ast.enums.length; i++) {
      if (ast.enums[i].name === checkType) {
        return true;
      }
    }
    return false;
  }

  getThisFieldMapType(expr: Expression): ThisFieldMapInfo | null {
    const exprBase = expr as ExprBase;
    if (exprBase.type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;

    const memberExprObjBase = memberExpr.object as ExprBase;
    if (memberExprObjBase.type === "this") {
      const fieldName = memberExpr.property;
      const currentCls = this.ctx.getCurrentClassName();
      if (!currentCls) return null;

      const fieldInfoResult = this.getClassFieldInfo(currentCls, fieldName);
      const fieldInfo = fieldInfoResult as FieldInfo;
      if (!fieldInfoResult || !fieldInfo.tsType) return null;

      const mapParsed = parseMapTypeString(fieldInfo.tsType);
      if (!mapParsed) return null;

      return { fieldName, keyType: mapParsed.keyType, valueType: mapParsed.valueType };
    }

    if (memberExprObjBase.type === "member_access") {
      const nestedType = this.resolveNestedMemberType(memberExpr.object);
      if (!nestedType) return null;

      const ifaceDecl = this.getInterface(nestedType);
      if (ifaceDecl) {
        const iface = ifaceDecl as InterfaceDeclaration;
        let field: { name: string; type: string } | null = null;
        const allIfaceFields = this.getAllInterfaceFields(iface);
        for (let i = 0; i < allIfaceFields.length; i++) {
          const f = allIfaceFields[i] as { name: string; type: string };
          if (f.name === memberExpr.property) {
            field = f;
            break;
          }
        }
        if (field) {
          const fieldTyped = field as { name: string; type: string };
          const mapParsed = parseMapTypeString(fieldTyped.type);
          if (mapParsed) {
            return {
              fieldName: memberExpr.property,
              keyType: mapParsed.keyType,
              valueType: mapParsed.valueType,
            };
          }
        }
      }

      const classDecl = this.getClass(nestedType);
      if (classDecl) {
        const cls = classDecl as ClassNode;
        let field: { name: string; tsType: string } | null = null;
        for (let i = 0; i < cls.fields.length; i++) {
          const f = cls.fields[i] as { name: string; tsType: string };
          if (f.name === memberExpr.property) {
            field = f;
            break;
          }
        }
        if (field) {
          const fieldTyped = field as { name: string; tsType: string };
          if (fieldTyped.tsType) {
            const mapParsed = parseMapTypeString(fieldTyped.tsType);
            if (mapParsed) {
              return {
                fieldName: memberExpr.property,
                keyType: mapParsed.keyType,
                valueType: mapParsed.valueType,
              };
            }
          }
        }
      }
    }

    return null;
  }

  private resolveNestedMemberType(expr: Expression): string | null {
    if (expr.type === "this") {
      return this.ctx.getCurrentClassName() || null;
    }

    if (expr.type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;

    const parentType = this.resolveNestedMemberType(memberExpr.object);
    if (!parentType) return null;

    const ifaceDecl = this.getInterface(parentType);
    if (ifaceDecl) {
      const iface = ifaceDecl as InterfaceDeclaration;
      let field: { name: string; type: string } | null = null;
      const allNestedFields = this.getAllInterfaceFields(iface);
      for (let i = 0; i < allNestedFields.length; i++) {
        const f = allNestedFields[i] as { name: string; type: string };
        if (f.name === memberExpr.property) {
          field = f;
          break;
        }
      }
      if (field) {
        const fieldTyped = field as { name: string; type: string };
        let fieldType = fieldTyped.type;
        if (fieldType.endsWith(" | null") || fieldType.endsWith(" | undefined")) {
          fieldType = fieldType.replace(/ \| null$/, "").replace(/ \| undefined$/, "");
        }
        if (fieldType.endsWith("?")) {
          fieldType = fieldType.slice(0, fieldType.length - 1);
        }
        return fieldType;
      }
    }

    const classDecl = this.getClass(parentType);
    if (classDecl) {
      const cls = classDecl as ClassNode;
      let field: { name: string; tsType: string } | null = null;
      for (let i = 0; i < cls.fields.length; i++) {
        const f = cls.fields[i] as { name: string; tsType: string };
        if (f.name === memberExpr.property) {
          field = f;
          break;
        }
      }
      if (field) {
        const fieldTyped = field as { name: string; tsType: string };
        if (fieldTyped.tsType) {
          let fieldType = fieldTyped.tsType;
          if (fieldType.endsWith(" | null") || fieldType.endsWith(" | undefined")) {
            fieldType = fieldType.replace(/ \| null$/, "").replace(/ \| undefined$/, "");
          }
          if (fieldType.endsWith("?")) {
            fieldType = fieldType.slice(0, fieldType.length - 1);
          }
          return fieldType;
        }
      }
    }

    return null;
  }

  getThisFieldSetType(expr: Expression): ThisFieldSetInfo | null {
    const exprBaseSet = expr as ExprBase;
    if (exprBaseSet.type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;
    const memberExprObjBaseSet = memberExpr.object as ExprBase;
    if (memberExprObjBaseSet.type !== "this") return null;

    const fieldName = memberExpr.property;
    const currentClsSet = this.ctx.getCurrentClassName();
    if (!currentClsSet) return null;

    const fieldInfoResult = this.getClassFieldInfo(currentClsSet, fieldName);
    const fieldInfo = fieldInfoResult as FieldInfo;
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const setParsed = parseSetTypeString(fieldInfo.tsType);
    if (!setParsed) return null;

    return { fieldName, valueType: setParsed.valueType };
  }

  getThisFieldMapKeyType(expr: Expression): string | null {
    const exprBaseKey = expr as ExprBase;
    if (exprBaseKey.type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;

    const memberExprObjBaseKey = memberExpr.object as ExprBase;
    if (memberExprObjBaseKey.type === "this") {
      const currentClsKey = this.ctx.getCurrentClassName();
      if (!currentClsKey) return null;
      const fieldInfoResult = this.getClassFieldInfo(currentClsKey, memberExpr.property);
      const fieldInfo = fieldInfoResult as FieldInfo;
      if (!fieldInfoResult || !fieldInfo.tsType) return null;

      const mapParsed = parseMapTypeString(fieldInfo.tsType);
      if (!mapParsed) return null;
      return mapParsed.keyType;
    }

    if (memberExprObjBaseKey.type === "member_access") {
      const nestedType = this.resolveNestedMemberType(memberExpr.object);
      if (!nestedType) return null;

      const ifaceDecl = this.getInterface(nestedType);
      if (ifaceDecl) {
        const iface = ifaceDecl as InterfaceDeclaration;
        let field: { name: string; type: string } | null = null;
        const allKeyFields = this.getAllInterfaceFields(iface);
        for (let i = 0; i < allKeyFields.length; i++) {
          const f = allKeyFields[i] as { name: string; type: string };
          if (f.name === memberExpr.property) {
            field = f;
            break;
          }
        }
        if (field) {
          const fieldTyped = field as { name: string; type: string };
          const mapParsed = parseMapTypeString(fieldTyped.type);
          if (mapParsed) {
            return mapParsed.keyType;
          }
        }
      }

      const classDecl = this.getClass(nestedType);
      if (classDecl) {
        const cls = classDecl as ClassNode;
        let field: { name: string; tsType: string } | null = null;
        for (let i = 0; i < cls.fields.length; i++) {
          const f = cls.fields[i] as { name: string; tsType: string };
          if (f.name === memberExpr.property) {
            field = f;
            break;
          }
        }
        if (field) {
          const fieldTyped = field as { name: string; tsType: string };
          if (fieldTyped.tsType) {
            const mapParsed = parseMapTypeString(fieldTyped.tsType);
            if (mapParsed) {
              return mapParsed.keyType;
            }
          }
        }
      }
    }

    return null;
  }

  getThisFieldSetValueType(expr: Expression): string | null {
    const exprBaseSetVal = expr as ExprBase;
    if (exprBaseSetVal.type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;
    const memberExprObjBaseSetVal = memberExpr.object as ExprBase;
    if (memberExprObjBaseSetVal.type !== "this") return null;

    const currentClsSetVal = this.ctx.getCurrentClassName();
    if (!currentClsSetVal) return null;
    const fieldInfoResult = this.getClassFieldInfo(currentClsSetVal, memberExpr.property);
    const fieldInfo = fieldInfoResult as FieldInfo;
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const setParsed = parseSetTypeString(fieldInfo.tsType);
    if (!setParsed) return null;
    return setParsed.valueType;
  }

  resolveArrayMethodReturnType(expr: Expression): ObjectMetadata | null {
    if (!expr || expr.type !== "method_call") return null;

    const methodCall = expr as MethodCallNode;
    const method = methodCall.method;

    if (method !== "find") return null;

    if (methodCall.object.type === "member_access") {
      const memberAccess = methodCall.object as MemberAccessNode;
      const propertyName = memberAccess.property;

      let objectInfo:
        | { ptr: string; keys: string[]; types: string[]; tsTypes?: string[] }
        | undefined;

      if (memberAccess.object.type === "variable") {
        const varName = (memberAccess.object as VariableNode).name;
        objectInfo = this.ctx.symbolTable.getObjectInfo(varName);
      } else if (
        memberAccess.object.type === "member_access" ||
        memberAccess.object.type === "this"
      ) {
        const arrayType = this.resolveMemberAccessArrayType(memberAccess);
        if (arrayType) {
          return this.getInterfaceMetadata(arrayType);
        }
        return null;
      }

      if (!objectInfo) return null;

      const propIndex = objectInfo.keys.indexOf(propertyName);
      if (propIndex === -1) return null;

      const tsTypesArr = objectInfo.tsTypes as string[];
      const propTsType = tsTypesArr[propIndex];
      if (!propTsType) return null;

      const arrayParsed = parseArrayTypeString(propTsType);
      if (!arrayParsed) return null;

      const elementType = arrayParsed.elementType;
      return this.getInterfaceMetadata(elementType);
    }

    if (methodCall.object.type === "variable") {
      const varExpr = methodCall.object as VariableNode;
      const varName = varExpr.name;
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return {
          keys: objArrayMeta.elementKeys,
          types: objArrayMeta.elementTypes,
          tsTypes: objArrayMeta.elementTsTypes,
        };
      }
    }

    return null;
  }
}
