import {
  Expression,
  MethodCallNode,
  AST,
  MemberAccessNode,
  IndexAccessNode,
  CallNode,
  ArrayNode,
  NewNode,
  FunctionNode,
  ClassNode,
  ClassMethod,
  VariableNode,
  ConditionalExpressionNode,
  InterfaceDeclaration,
  InterfaceField,
  BinaryNode,
  TypeAssertionNode,
  UnaryNode,
  MapNode,
  SetNode,
} from "../../ast/types.js";
import { SymbolTable, SymbolKind } from "./symbol-table.js";
import type { TypeChecker } from "../../typescript/type-checker.js";
import type { ClassGenerator } from "../types/objects/class.js";
import type { TypeResolver } from "./type-resolver/index.js";
import type { FieldInfo } from "./type-resolver/types.js";
import { stripNullable, parseMapTypeString } from "./type-system.js";
import type { ResolvedType } from "./type-system.js";
import type { TypeContext } from "./type-context.js";

interface ExprBase {
  type: string;
}

function isStringType(t: string): boolean {
  if (t === "string") return true;
  if (t === "string | null" || t === "string | undefined") return true;
  if (t === "null | string" || t === "undefined | string") return true;
  // FFI pointer types (i8_ptr, ptr) are stored as i8* like strings
  if (t === "i8_ptr" || t === "ptr") return true;
  return false;
}

export interface TypeInferenceContext {
  symbolTable: SymbolTable;
  typeContext: TypeContext;
  getExpectedArrayElementType(): "string" | "number" | "boolean" | "pointer" | null;
  currentClassName: string | null;
  getCurrentClassName(): string | null;
  currentFunction: string;
  getCurrentFunction(): string | null;
  ast: AST;
  getAst(): AST | undefined;
  typeChecker: TypeChecker | null;
  classGen: ClassGenerator | null;
  hasClassGen(): boolean;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  classGenGetFieldType(className: string, fieldName: string): string | null;
  classGenGetFieldTsType(className: string, fieldName: string): string | null;
  typeResolver?: TypeResolver;
  typeResolverGetInterface(name: string): InterfaceDeclaration | null;
  typeResolverGetInterfaceProperty(interfaceName: string, propName: string): InterfaceField | null;
}

export class TypeInference {
  constructor(private ctx: TypeInferenceContext) {}

  private resolveSimpleLiteralType(eType: string): ResolvedType | null {
    if (eType === "number") return this.ctx.typeContext.numberType;
    if (eType === "string") return this.ctx.typeContext.stringType;
    if (eType === "template_literal") return this.ctx.typeContext.stringType;
    if (eType === "boolean") return this.ctx.typeContext.booleanType;
    return null;
  }

  private resolveSpecialLiteralType(eType: string): ResolvedType | null {
    if (eType === "null") return this.ctx.typeContext.nullType;
    if (eType === "regex") return this.ctx.typeContext.resolve("RegExp");
    if (eType === "object") return this.ctx.typeContext.resolve("object");
    return null;
  }

  resolveExpressionType(expr: Expression): ResolvedType | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (!e.type) return null;
    const simple = this.resolveSimpleLiteralType(e.type);
    if (simple) return simple;
    const special = this.resolveSpecialLiteralType(e.type);
    if (special) return special;

    const collection = this.resolveCollectionExprType(e, expr);
    if (collection !== undefined) return collection;

    const compound = this.resolveCompoundExprType(e, expr);
    if (compound !== undefined) return compound;

    const dispatch = this.resolveDispatchExprType(e, expr);
    if (dispatch !== undefined) return dispatch;

    const complex = this.resolveComplexExprType(e, expr);
    if (complex !== undefined) return complex;

    return null;
  }

  private resolveCollectionExprType(
    e: ExprBase,
    expr: Expression,
  ): ResolvedType | null | undefined {
    if (e.type === "map") {
      const mapExpr = expr as MapNode;
      const keyType = mapExpr.keyType || "string";
      const valueType = mapExpr.valueType || "string";
      return this.ctx.typeContext.getMapType(keyType, valueType);
    }
    if (e.type === "set") {
      const setExpr = expr as SetNode;
      const valType = setExpr.valueType || "string";
      return this.ctx.typeContext.getSetType(valType);
    }
    if (e.type === "variable") {
      return this.resolveVariableType((expr as VariableNode).name);
    }
    if (e.type === "new") {
      const newExpr = expr as NewNode;
      if (newExpr.className === "Map") {
        const kType =
          newExpr.typeArgs && newExpr.typeArgs.length > 0 ? newExpr.typeArgs[0] : "string";
        const vType =
          newExpr.typeArgs && newExpr.typeArgs.length > 1 ? newExpr.typeArgs[1] : "string";
        return this.ctx.typeContext.getMapType(kType, vType);
      }
      if (newExpr.className === "Set") {
        const valType =
          newExpr.typeArgs && newExpr.typeArgs.length > 0 ? newExpr.typeArgs[0] : "number";
        return this.ctx.typeContext.getSetType(valType);
      }
      if (newExpr.className === "RegExp") return this.ctx.typeContext.resolve("RegExp");
      if (newExpr.className === "Promise") return this.ctx.typeContext.resolve("Promise");
      if (newExpr.className === "Uint8Array") return this.ctx.typeContext.resolve("Uint8Array");
      const resolvedClassName = this.resolveClassAlias(newExpr.className);
      const cls = this.getClass(resolvedClassName);
      if (cls) return this.ctx.typeContext.getClassType(resolvedClassName);
      return null;
    }
    return undefined;
  }

  private resolveCompoundExprType(e: ExprBase, expr: Expression): ResolvedType | null | undefined {
    if (e.type === "array") {
      const arrayExpr = expr as ArrayNode;
      const elements = arrayExpr.elements || [];
      if (elements.length === 0) {
        const expected = this.ctx.getExpectedArrayElementType();
        if (expected === "string") return this.ctx.typeContext.getArrayType("string");
        return this.ctx.typeContext.getArrayType("number");
      }
      const firstElem = elements[0] as ExprBase;
      if (firstElem.type === "string") return this.ctx.typeContext.getArrayType("string");
      if (firstElem.type === "number") return this.ctx.typeContext.getArrayType("number");
      if (firstElem.type === "variable") {
        const varName = (elements[0] as VariableNode).name;
        if (this.ctx.symbolTable.isString(varName))
          return this.ctx.typeContext.getArrayType("string");
        const varType = this.ctx.symbolTable.getType(varName);
        if (varType === "i8*") return this.ctx.typeContext.getArrayType("string");
      }
      if (this.isStringExpression(elements[0])) return this.ctx.typeContext.getArrayType("string");
      if (firstElem.type === "object") return this.ctx.typeContext.getArrayType("object");
      return this.ctx.typeContext.getArrayType("number");
    }
    if (e.type === "unary") {
      const unaryExpr = expr as UnaryNode;
      if (unaryExpr.op === "typeof") return this.ctx.typeContext.stringType;
      if (unaryExpr.op === "!") return this.ctx.typeContext.booleanType;
      if (unaryExpr.op === "-" || unaryExpr.op === "+" || unaryExpr.op === "~")
        return this.ctx.typeContext.numberType;
    }
    if (e.type === "type_assertion") {
      const assertion = expr as TypeAssertionNode;
      if (assertion.assertedType) {
        return this.ctx.typeContext.resolve(stripNullable(assertion.assertedType));
      }
    }
    if (e.type === "call") {
      const callExpr = expr as CallNode;
      if (callExpr.name === "String") return this.ctx.typeContext.stringType;
      if (callExpr.name === "Number") return this.ctx.typeContext.numberType;
      if (callExpr.name === "Boolean") return this.ctx.typeContext.booleanType;
      if (callExpr.name === "fetch") return this.ctx.typeContext.resolve("Promise");
      if (callExpr.name === "__ts_node_type" || callExpr.name === "__ts_node_text")
        return this.ctx.typeContext.stringType;
      if (callExpr.name) {
        const func = this.getFunction(callExpr.name);
        if (func) {
          if (func.async) return this.ctx.typeContext.resolve("Promise");
          if (func.returnType) return this.ctx.typeContext.resolve(stripNullable(func.returnType));
        }
      }
    }
    return undefined;
  }

  private resolveDispatchExprType(e: ExprBase, expr: Expression): ResolvedType | null | undefined {
    if (e.type === "method_call") {
      return this.resolveMethodCallType(expr as MethodCallNode);
    }
    if (e.type === "member_access") {
      return this.resolveMemberAccessType(expr as MemberAccessNode);
    }
    if (e.type === "this") {
      const className = this.ctx.getCurrentClassName();
      if (className) return this.ctx.typeContext.getClassType(className);
    }
    if (e.type === "binary") {
      const binExpr = expr as BinaryNode;
      if (
        binExpr.op === "===" ||
        binExpr.op === "!==" ||
        binExpr.op === "==" ||
        binExpr.op === "!=" ||
        binExpr.op === "<" ||
        binExpr.op === ">" ||
        binExpr.op === "<=" ||
        binExpr.op === ">=" ||
        binExpr.op === "instanceof" ||
        binExpr.op === "in"
      ) {
        return this.ctx.typeContext.booleanType;
      }
      if (binExpr.op === "+") {
        const leftResolved = this.resolveExpressionType(binExpr.left);
        if (leftResolved && leftResolved.base === "string" && leftResolved.arrayDepth === 0) {
          return this.ctx.typeContext.stringType;
        }
        const rightResolved = this.resolveExpressionType(binExpr.right);
        if (rightResolved && rightResolved.base === "string" && rightResolved.arrayDepth === 0) {
          return this.ctx.typeContext.stringType;
        }
        return this.ctx.typeContext.numberType;
      }
      if (
        binExpr.op === "-" ||
        binExpr.op === "*" ||
        binExpr.op === "/" ||
        binExpr.op === "%" ||
        binExpr.op === "**" ||
        binExpr.op === "<<" ||
        binExpr.op === ">>" ||
        binExpr.op === ">>>" ||
        binExpr.op === "&" ||
        binExpr.op === "|" ||
        binExpr.op === "^"
      ) {
        return this.ctx.typeContext.numberType;
      }
      if (binExpr.op === "||" || binExpr.op === "??") {
        const leftResolved = this.resolveExpressionType(binExpr.left);
        if (leftResolved) return leftResolved;
        const rightResolved = this.resolveExpressionType(binExpr.right);
        if (rightResolved) return rightResolved;
      }
    }
    return undefined;
  }

  private resolveComplexExprType(e: ExprBase, expr: Expression): ResolvedType | null | undefined {
    if (e.type === "conditional") {
      const condExpr = expr as ConditionalExpressionNode;
      const consequentResolved = this.resolveExpressionType(condExpr.consequent);
      if (consequentResolved) return consequentResolved;
      const alternateResolved = this.resolveExpressionType(condExpr.alternate);
      if (alternateResolved) return alternateResolved;
    }
    if (e.type === "index_access") {
      const indexExpr = expr as IndexAccessNode;
      const objResolved = this.resolveExpressionType(indexExpr.object);
      if (objResolved && objResolved.arrayDepth > 0) {
        if (
          objResolved.base === "string" ||
          objResolved.base === "number" ||
          objResolved.base === "boolean"
        ) {
          return this.ctx.typeContext.resolve(objResolved.base);
        }
      }
      if (objResolved && objResolved.base === "string" && objResolved.arrayDepth === 0) {
        return this.ctx.typeContext.stringType;
      }
    }
    return undefined;
  }

  private resolveVariableType(name: string): ResolvedType | null {
    const cached = this.ctx.symbolTable.getResolvedType(name);
    if (cached) return cached;
    const varType = this.ctx.symbolTable.getType(name);
    if (varType) {
      const fromVarType = this.resolveFromVarType(varType);
      if (fromVarType) return fromVarType;
    }
    const fromSymbol = this.resolveFromSymbolKind(name);
    if (fromSymbol) return fromSymbol;
    if (varType) {
      if (varType === "i8*") {
        const ifaceType = this.ctx.symbolTable.getInterfaceType(name);
        if (ifaceType && ifaceType.length > 0)
          return this.ctx.typeContext.getInterfaceType(ifaceType);
        return this.ctx.typeContext.stringType;
      }
      if (varType.startsWith("%") && varType.endsWith("*")) {
        const typeName = varType.substring(1, varType.length - 1);
        if (this.getInterface(typeName)) return this.ctx.typeContext.getInterfaceType(typeName);
        if (this.getClass(typeName)) return this.ctx.typeContext.getClassType(typeName);
      }
    }
    const paramType = this.getParameterType(name);
    if (paramType) {
      return this.ctx.typeContext.resolve(stripNullable(paramType));
    }
    return null;
  }

  private resolveFromVarType(varType: string): ResolvedType | null {
    if (varType === "%StringArray*" || varType === "%StringArray")
      return this.ctx.typeContext.getArrayType("string");
    if (varType === "%Array*" || varType === "%Array")
      return this.ctx.typeContext.getArrayType("number");
    if (varType === "%ObjectArray*") return this.ctx.typeContext.getArrayType("object");
    if (varType === "%StringMap*") return this.ctx.typeContext.getMapType("string", "string");
    return this.resolveFromVarTypeExtended(varType);
  }

  private resolveFromVarTypeExtended(varType: string): ResolvedType | null {
    if (varType === "%StringSet*") return this.ctx.typeContext.getSetType("string");
    if (varType === "%Promise*") return this.ctx.typeContext.resolve("Promise");
    if (varType === "%__FetchResponse*") return this.ctx.typeContext.resolve("Response");
    if (varType === "double") return this.ctx.typeContext.numberType;
    return null;
  }

  private resolveFromSymbolKind(name: string): ResolvedType | null {
    if (this.ctx.symbolTable.isString(name)) return this.ctx.typeContext.stringType;
    if (this.ctx.symbolTable.isBoolean(name)) return this.ctx.typeContext.booleanType;
    if (this.ctx.symbolTable.isNumberArray(name))
      return this.ctx.typeContext.getArrayType("number");
    if (this.ctx.symbolTable.isMap(name))
      return this.ctx.typeContext.getMapType("string", "string");
    if (this.ctx.symbolTable.isSet(name)) return this.ctx.typeContext.getSetType("string");
    return this.resolveFromSymbolKindExtended(name);
  }

  private resolveFromSymbolKindExtended(name: string): ResolvedType | null {
    if (this.ctx.symbolTable.isRegex(name)) return this.ctx.typeContext.resolve("RegExp");
    if (this.ctx.symbolTable.isObject(name)) return this.ctx.typeContext.resolve("object");
    if (this.ctx.symbolTable.isJSON(name)) return this.ctx.typeContext.resolve("object");
    if (this.ctx.symbolTable.isClass(name)) {
      const className = this.ctx.symbolTable.getClassName(name);
      if (className) return this.ctx.typeContext.getClassType(className);
    }
    if (this.ctx.symbolTable.isObjectArray(name))
      return this.ctx.typeContext.getArrayType("object");
    return null;
  }

  private resolveMethodCallType(expr: MethodCallNode): ResolvedType | null {
    const method = expr.method;
    const objBase = expr.object as ExprBase;

    if (
      method === "trim" ||
      method === "toLowerCase" ||
      method === "toUpperCase" ||
      method === "replace" ||
      method === "replaceAll" ||
      method === "repeat" ||
      method === "padStart" ||
      method === "padEnd" ||
      method === "charAt" ||
      method === "substr" ||
      method === "substring" ||
      method === "toString" ||
      method === "text" ||
      method === "trimStart" ||
      method === "trimEnd" ||
      method === "toFixed" ||
      method === "normalize" ||
      method === "getVariableType"
    ) {
      return this.ctx.typeContext.stringType;
    }

    if (method === "at" || method === "find") {
      if (this.isArrayExpression(expr.object)) return this.ctx.typeContext.numberType;
      return this.ctx.typeContext.stringType;
    }

    if (method === "join") return this.ctx.typeContext.stringType;

    if (method === "split") return this.ctx.typeContext.getArrayType("string");

    if (
      method === "indexOf" ||
      method === "lastIndexOf" ||
      method === "search" ||
      method === "charCodeAt" ||
      method === "codePointAt" ||
      method === "localeCompare" ||
      method === "findIndex"
    ) {
      return this.ctx.typeContext.numberType;
    }

    if (
      method === "startsWith" ||
      method === "endsWith" ||
      method === "test" ||
      method === "has" ||
      method === "delete" ||
      method === "every" ||
      method === "some" ||
      method === "includes" ||
      method === "isFile" ||
      method === "isDirectory"
    ) {
      return this.ctx.typeContext.booleanType;
    }

    if (method === "match" || method === "exec" || method === "execDyn") {
      return this.ctx.typeContext.getArrayType("string");
    }

    if (method === "then" || method === "catch") {
      if (this.isPromiseExpression(expr.object)) return this.ctx.typeContext.resolve("Promise");
    }

    const objDispatch = this.resolveMethodCallByObjectType(expr, method, objBase);
    if (objDispatch) return objDispatch;

    return this.resolveMethodCallByMethod(expr, method, objBase);
  }

  private resolveMethodCallByObjectType(
    expr: MethodCallNode,
    method: string,
    objBase: ExprBase,
  ): ResolvedType | null {
    if (objBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;

      if (varName === "fs" && method === "readFileSync") return this.ctx.typeContext.stringType;
      if (varName === "fs" && method === "existsSync") return this.ctx.typeContext.booleanType;
      if (varName === "fs" && method === "readdirSync")
        return this.ctx.typeContext.getArrayType("string");

      if (varName === "path") {
        if (
          method === "resolve" ||
          method === "dirname" ||
          method === "join" ||
          method === "basename" ||
          method === "normalize" ||
          method === "extname" ||
          method === "relative"
        ) {
          return this.ctx.typeContext.stringType;
        }
      }

      if (varName === "JSON" && method === "stringify") return this.ctx.typeContext.stringType;
      if (varName === "String" && method === "fromCharCode") return this.ctx.typeContext.stringType;

      if (varName === "crypto") {
        if (
          method === "sha256" ||
          method === "md5" ||
          method === "sha512" ||
          method === "randomBytes"
        ) {
          return this.ctx.typeContext.stringType;
        }
      }

      if (varName === "sqlite" && method === "open") return this.ctx.typeContext.stringType;
      if (varName === "sqlite" && method === "get") return this.ctx.typeContext.stringType;
      if (varName === "sqlite" && method === "all")
        return this.ctx.typeContext.getArrayType("string");

      if (varName === "Object" && method === "keys")
        return this.ctx.typeContext.getArrayType("string");
      if (varName === "Object" && method === "entries")
        return this.ctx.typeContext.getArrayType("string");

      if (varName === "Promise") return this.ctx.typeContext.resolve("Promise");

      if (varName === "ChadScript") {
        if (method === "embedFile" || method === "getEmbeddedFile")
          return this.ctx.typeContext.stringType;
      }

      if (varName === "os") {
        if (method === "hostname" || method === "homedir" || method === "tmpdir")
          return this.ctx.typeContext.stringType;
        if (
          method === "cpus" ||
          method === "totalmem" ||
          method === "freemem" ||
          method === "uptime"
        )
          return this.ctx.typeContext.numberType;
      }

      if (varName === "process") {
        if (method === "cwd") return this.ctx.typeContext.stringType;
        if (method === "uptime") return this.ctx.typeContext.numberType;
      }

      if (varName === "Date") {
        if (method === "now") return this.ctx.typeContext.numberType;
      }

      if (varName === "Array" && method === "from")
        return this.ctx.typeContext.getArrayType("number");

      if (this.ctx.symbolTable.isClass(varName)) {
        const className = this.ctx.symbolTable.getClassName(varName);
        if (className) {
          const classMethod = this.getClassMethod(className, method);
          if (classMethod && classMethod.returnType) {
            return this.ctx.typeContext.resolve(stripNullable(classMethod.returnType));
          }
        }
      }

      const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
      if (ifaceType && ifaceType.length > 0) {
        const methodReturnType = this.getInterfaceMethodReturnType(ifaceType, method);
        if (methodReturnType) {
          return this.ctx.typeContext.resolve(stripNullable(methodReturnType));
        }
      }
    }

    if (objBase.type === "this") {
      const className = this.ctx.getCurrentClassName();
      if (className) {
        const classMethod = this.getClassMethod(className, method);
        if (classMethod && classMethod.returnType) {
          return this.ctx.typeContext.resolve(stripNullable(classMethod.returnType));
        }
      }
    }

    if (objBase.type === "member_access") {
      const memberAccess = expr.object as MemberAccessNode;
      const fieldClassName = this.resolveClassNameFromExpression(memberAccess);
      if (fieldClassName) {
        const classMethod = this.getClassMethod(fieldClassName, method);
        if (classMethod && classMethod.returnType) {
          return this.ctx.typeContext.resolve(stripNullable(classMethod.returnType));
        }
      }
      const interfaceType = this.resolveInterfaceTypeFromExpression(memberAccess);
      if (interfaceType) {
        const methodReturnType = this.getInterfaceMethodReturnType(interfaceType, method);
        if (methodReturnType) {
          return this.ctx.typeContext.resolve(stripNullable(methodReturnType));
        }
      }
    }

    return null;
  }

  private resolveMethodCallByMethod(
    expr: MethodCallNode,
    method: string,
    objBase: ExprBase,
  ): ResolvedType | null {
    if (method === "slice" || method === "concat") {
      const objResolved = this.resolveExpressionType(expr.object);
      if (objResolved) return objResolved;
    }

    if (
      method === "filter" ||
      method === "map" ||
      method === "sort" ||
      method === "reverse" ||
      method === "flat" ||
      method === "flatMap"
    ) {
      const objResolved = this.resolveExpressionType(expr.object);
      if (objResolved && objResolved.arrayDepth > 0) return objResolved;
    }

    if (method === "keys" || method === "values") {
      if (objBase.type === "variable") {
        const varName = (expr.object as VariableNode).name;
        if (this.ctx.symbolTable.isMap(varName)) {
          const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
          if (mapMeta) {
            if (method === "keys" && mapMeta.keyType === "string") {
              return this.ctx.typeContext.getArrayType("string");
            }
            return this.ctx.typeContext.getArrayType("number");
          }
        }
      }
    }

    if (method === "values" || method === "entries") {
      if (objBase.type === "variable" && (expr.object as VariableNode).name === "Object") {
        return null;
      }
      const objResolved = this.resolveExpressionType(expr.object);
      if (objResolved && objResolved.arrayDepth > 0) return objResolved;
    }

    if (method === "push" || method === "unshift") {
      return this.ctx.typeContext.numberType;
    }

    if (method === "pop" || method === "shift") {
      if (objBase.type === "variable") {
        const varName = (expr.object as VariableNode).name;
        if (this.ctx.symbolTable.isStringArray(varName)) {
          return this.ctx.typeContext.stringType;
        }
      }
      return this.ctx.typeContext.numberType;
    }

    if (method === "get") {
      if (objBase.type === "variable") {
        const varName = (expr.object as VariableNode).name;
        if (this.ctx.symbolTable.isMap(varName)) {
          const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
          if (mapMeta && mapMeta.valueType) {
            if (mapMeta.valueType === "string") return this.ctx.typeContext.stringType;
            if (this.getClass(mapMeta.valueType))
              return this.ctx.typeContext.getClassType(mapMeta.valueType);
            return this.ctx.typeContext.resolve(mapMeta.valueType);
          }
        }
      }
      if (objBase.type === "member_access") {
        const memberAccess = expr.object as MemberAccessNode;
        const memberAccessObjBase = memberAccess.object as ExprBase;
        if (
          memberAccessObjBase.type === "this" &&
          this.ctx.getCurrentClassName() &&
          this.ctx.hasClassGen()
        ) {
          const fieldInfoResult = this.ctx.classGenGetFieldInfo(
            this.ctx.getCurrentClassName(),
            memberAccess.property,
          );
          const fieldInfo = fieldInfoResult as FieldInfo;
          if (fieldInfoResult && fieldInfo.tsType) {
            const mapParsed = parseMapTypeString(fieldInfo.tsType);
            if (mapParsed) {
              return this.ctx.typeContext.resolve(mapParsed.valueType);
            }
          }
        }
      }
    }

    return null;
  }

  private resolveMemberAccessType(expr: MemberAccessNode): ResolvedType | null {
    if (!expr.object) return null;
    const objBase = expr.object as ExprBase;
    if (!objBase.type) return null;
    const prop = expr.property;

    if (objBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;

      if (varName === "process") {
        if (
          prop === "platform" ||
          prop === "arch" ||
          prop === "version" ||
          prop === "execPath" ||
          prop === "argv0"
        ) {
          return this.ctx.typeContext.stringType;
        }
        if (prop === "argv") return this.ctx.typeContext.getArrayType("string");
        if (prop === "exitCode" || prop === "pid") return this.ctx.typeContext.numberType;
      }

      if (varName === "Math") {
        if (
          prop === "PI" ||
          prop === "E" ||
          prop === "LN2" ||
          prop === "LN10" ||
          prop === "SQRT2"
        ) {
          return this.ctx.typeContext.numberType;
        }
      }

      if (varName === "Number") {
        if (prop === "MAX_SAFE_INTEGER" || prop === "MIN_SAFE_INTEGER" || prop === "MAX_VALUE") {
          return this.ctx.typeContext.numberType;
        }
      }

      if (varName === "os") {
        if (prop === "platform" || prop === "arch" || prop === "EOL") {
          return this.ctx.typeContext.stringType;
        }
      }

      // Check if this is an enum member access (e.g., Direction.Up).
      // Type assertion must match real struct field order: { name, members, isString }
      if (this.ctx.ast && this.ctx.ast.enums) {
        for (let ei = 0; ei < this.ctx.ast.enums.length; ei++) {
          const en = this.ctx.ast.enums[ei] as {
            name: string;
            members: { name: string; value: number; stringValue?: string }[];
            isString?: boolean;
          };
          if (en.name === varName) {
            if (en.isString) {
              return this.ctx.typeContext.stringType;
            }
            return this.ctx.typeContext.numberType;
          }
        }
      }

      const propType = this.ctx.symbolTable.getObjectPropertyType(varName, prop);
      if (propType === "i8*") {
        const keys = this.ctx.symbolTable.getObjectMetadataKeys(varName);
        const tsTypes = this.ctx.symbolTable.getObjectMetadataTsTypes(varName);
        if (keys && tsTypes) {
          for (let ki = 0; ki < keys.length; ki++) {
            if (keys[ki] === prop && tsTypes[ki]) {
              return this.ctx.typeContext.resolve(stripNullable(tsTypes[ki]));
            }
          }
        }
        return this.ctx.typeContext.stringType;
      }
      if (propType === "double") return this.ctx.typeContext.numberType;
      if (propType === "%StringArray*") return this.ctx.typeContext.getArrayType("string");
      if (propType === "%Array*") return this.ctx.typeContext.getArrayType("number");
      if (propType === "%ObjectArray*") return this.ctx.typeContext.getArrayType("object");

      if (this.ctx.symbolTable.isClass(varName)) {
        const className = this.ctx.symbolTable.getClassName(varName);
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, prop);
          if (fieldType) return this.ctx.typeContext.resolve(fieldType);
          const tsType = this.ctx.classGenGetFieldTsType(className, prop);
          if (tsType) return this.ctx.typeContext.resolve(stripNullable(tsType));
        }
      }

      const varType = this.ctx.symbolTable.getType(varName);
      if (
        varType &&
        varType.startsWith("%") &&
        varType.endsWith("*") &&
        varType.indexOf("Array") === -1 &&
        varType.indexOf("Response") === -1 &&
        varType.indexOf("Map") === -1 &&
        varType.indexOf("Set") === -1
      ) {
        const structTypeName = varType.substring(1, varType.length - 1);
        const ifaceProp = this.getInterfaceProperty(structTypeName, prop);
        if (ifaceProp) return this.ctx.typeContext.resolve(stripNullable(ifaceProp.type));
      }

      const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
      if (ifaceType && ifaceType.length > 0) {
        const ifaceProp = this.getInterfaceProperty(ifaceType, prop);
        if (ifaceProp) return this.ctx.typeContext.resolve(stripNullable(ifaceProp.type));
      }

      const paramType = this.getParameterType(varName);
      if (paramType) {
        const fieldType = this.getFieldTypeFromType(paramType, prop);
        if (fieldType) return this.ctx.typeContext.resolve(stripNullable(fieldType));
      }

      const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objMeta && objMeta.keys) {
        for (let ki = 0; ki < objMeta.keys.length; ki++) {
          if (objMeta.keys[ki] === prop) {
            if (objMeta.tsTypes && objMeta.tsTypes[ki]) {
              return this.ctx.typeContext.resolve(stripNullable(objMeta.tsTypes[ki]));
            }
            if (objMeta.types && objMeta.types[ki]) {
              return this.ctx.typeContext.resolve(stripNullable(objMeta.types[ki]));
            }
          }
        }
      }
    }

    if (objBase.type === "this") {
      const className = this.ctx.getCurrentClassName();
      if (className) {
        const tsType = this.ctx.classGenGetFieldTsType(className, prop);
        if (tsType) return this.ctx.typeContext.resolve(stripNullable(tsType));
        const fieldType = this.ctx.classGenGetFieldType(className, prop);
        if (fieldType) return this.ctx.typeContext.resolve(fieldType);
      }
    }

    if (objBase.type === "type_assertion") {
      const assertion = expr.object as TypeAssertionNode;
      if (assertion.assertedType) {
        const fieldType = this.getFieldTypeFromType(assertion.assertedType, prop);
        if (fieldType) return this.ctx.typeContext.resolve(stripNullable(fieldType));
      }
    }

    if (objBase.type === "member_access") {
      const nestedMember = expr.object as MemberAccessNode;
      const nestedObjBase = nestedMember.object as ExprBase;
      if (
        nestedObjBase.type === "variable" &&
        (nestedMember.object as VariableNode).name === "process" &&
        nestedMember.property === "env"
      ) {
        return this.ctx.typeContext.stringType;
      }
      if (nestedObjBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldTsType = this.ctx.classGenGetFieldTsType(className, nestedMember.property);
          if (fieldTsType) {
            const fieldType = this.getFieldTypeFromType(fieldTsType, prop);
            if (fieldType) return this.ctx.typeContext.resolve(stripNullable(fieldType));
          }
        }
      }
      const nestedType = this.resolveNestedMemberAccessTsType(nestedMember);
      if (nestedType) {
        const fieldType = this.getFieldTypeFromType(nestedType, prop);
        if (fieldType) return this.ctx.typeContext.resolve(stripNullable(fieldType));
      }
    }

    return null;
  }

  private getInterface(name: string): InterfaceDeclaration | null {
    const result = this.ctx.typeResolverGetInterface(name);
    if (result) {
      return result;
    }
    const ast = this.ctx.getAst();
    if (!ast || !ast.interfaces) return null;
    for (let i = 0; i < ast.interfaces.length; i++) {
      const iface = ast.interfaces[i] as InterfaceDeclaration;
      if (iface.name === name) {
        return iface;
      }
    }
    return null;
  }

  private getAllFieldsForInterface(iface: InterfaceDeclaration): InterfaceField[] {
    const result: InterfaceField[] = [];
    if (iface.extends && iface.extends.length > 0) {
      for (let i = 0; i < iface.extends.length; i++) {
        const parentName = iface.extends[i];
        const parent = this.getInterface(parentName);
        if (parent) {
          const parentFields = this.getAllFieldsForInterface(parent);
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

  private getInterfaceProperty(interfaceName: string, propName: string): InterfaceField | null {
    if (!interfaceName || !propName) {
      return null;
    }
    const result = this.ctx.typeResolverGetInterfaceProperty(interfaceName, propName);
    if (result) {
      return result;
    }
    const iface = this.getInterface(interfaceName);
    if (!iface) return null;
    const allFields = this.getAllFieldsForInterface(iface);
    for (let i = 0; i < allFields.length; i++) {
      const f = allFields[i] as { name: string; type: string };
      let fieldName = f.name;
      if (fieldName.endsWith("?")) {
        fieldName = fieldName.slice(0, fieldName.length - 1);
      }
      if (fieldName === propName) {
        return f;
      }
    }
    return null;
  }

  private getInterfaceMethodReturnType(interfaceName: string, methodName: string): string | null {
    const baseType = interfaceName
      .replace(/ \| null$/, "")
      .replace(/ \| undefined$/, "")
      .trim();
    const iface = this.getInterface(baseType);
    if (!iface || !iface.methods) return null;
    for (let i = 0; i < iface.methods.length; i++) {
      const m = iface.methods[i];
      if (m.name === methodName) {
        return m.returnType;
      }
    }
    return null;
  }

  private getFunction(name: string): FunctionNode | null {
    const ast = this.ctx.getAst();
    if (!ast || !ast.functions) return null;
    for (let i = 0; i < ast.functions.length; i++) {
      const func = ast.functions[i];
      if (func.name === name) {
        return func;
      }
    }
    return null;
  }

  private getCallReturnType(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type !== "call") return null;
    const callExpr = expr as CallNode;
    const func = this.getFunction(callExpr.name);
    if (!func || !func.returnType) return null;
    return stripNullable(func.returnType);
  }

  // Resolve import aliases by checking the AST's import specifiers directly
  private resolveClassAlias(name: string): string {
    const ast = this.ctx.getAst();
    if (!ast) return name;
    // Check struct-of-arrays import aliases (used for default imports)
    if (ast.importAliasNames && ast.importAliasOriginals) {
      for (let i = 0; i < ast.importAliasNames.length; i++) {
        if (ast.importAliasNames[i] === name) {
          return ast.importAliasOriginals[i];
        }
      }
    }
    // Also check aliasedSpecifiers on imports (used for named import aliases)
    if (ast.imports) {
      for (let i = 0; i < ast.imports.length; i++) {
        const imp = ast.imports[i];
        if (!imp.aliasedSpecifiers) continue;
        for (let j = 0; j < imp.aliasedSpecifiers.length; j++) {
          const spec = imp.aliasedSpecifiers[j];
          if (spec.name === name && spec.original) {
            return spec.original;
          }
        }
      }
    }
    return name;
  }

  private getClass(name: string): ClassNode | null {
    if (!name) return null;
    if (name.length === 0) return null;
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) return null;
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      if (!cls) continue;
      if (!cls.name) continue;
      if (cls.name === name) {
        return cls;
      }
    }
    return null;
  }

  private getClassMethod(className: string, methodName: string): ClassMethod | null {
    let cls = this.getClass(className);
    while (cls) {
      for (let i = 0; i < cls.methods.length; i++) {
        const method = cls.methods[i];
        if (!method) continue;
        if (!method.name) continue;
        if (method.name === methodName && !method.isConstructor) {
          return method;
        }
      }
      if (cls.extends) {
        cls = this.getClass(cls.extends);
      } else {
        cls = null;
      }
    }
    return null;
  }

  private getParameterType(paramName: string): string | null {
    const currentFunc = this.ctx.getCurrentFunction();
    if (!currentFunc) return null;
    const func = this.getFunction(currentFunc);
    if (func && func.parameters) {
      for (let i = 0; i < func.parameters.length; i++) {
        const p = func.parameters[i] as { name: string; type?: string };
        if (p.name === paramName && p.type) {
          return p.type;
        }
      }
    }
    const className = this.ctx.getCurrentClassName();
    if (className) {
      const method = this.getClassMethod(className, currentFunc);
      if (method && method.paramTypes) {
        for (let i = 0; i < method.params.length; i++) {
          if (method.params[i] === paramName && method.paramTypes[i]) {
            return method.paramTypes[i];
          }
        }
      }
    }
    return null;
  }

  private resolveClassNameFromExpression(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === "this") {
      return this.ctx.getCurrentClassName();
    }
    if (e.type === "variable") {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        return this.ctx.symbolTable.getClassName(varName) || null;
      }
      return null;
    }
    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      const objectType = this.resolveTypeFromExpression(memberExpr.object);
      if (!objectType) return null;
      const fieldType = this.getFieldTypeFromType(objectType, memberExpr.property);
      if (fieldType) {
        const baseFieldType = stripNullable(fieldType);
        const cls = this.getClass(baseFieldType);
        if (cls) return baseFieldType;
      }
      return null;
    }
    return null;
  }

  private resolveTypeFromExpression(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === "this") {
      return this.ctx.getCurrentClassName();
    }
    if (e.type === "variable") {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        return this.ctx.symbolTable.getClassName(varName) || null;
      }
      const interfaceType = this.ctx.symbolTable.getInterfaceType(varName);
      if (interfaceType) {
        return interfaceType;
      }
      return null;
    }
    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      const objectType = this.resolveTypeFromExpression(memberExpr.object);
      if (!objectType) return null;
      return this.getFieldTypeFromType(objectType, memberExpr.property);
    }
    if (e.type === "type_assertion") {
      const assertion = expr as TypeAssertionNode;
      if (assertion.assertedType) {
        return assertion.assertedType;
      }
    }
    return null;
  }

  private getFieldTypeFromType(typeName: string, fieldName: string): string | null {
    if (!typeName) return null;
    if (!fieldName) return null;
    const stripped = stripNullable(typeName);
    if (stripped !== typeName) {
      return this.getFieldTypeFromType(stripped, fieldName);
    }
    const cls = this.getClass(typeName);
    if (cls) {
      const fieldTsType = this.ctx.classGenGetFieldTsType(typeName, fieldName);
      if (fieldTsType) return fieldTsType;
    }
    const iface = this.getInterface(typeName);
    if (iface) {
      const field = this.getInterfaceProperty(typeName, fieldName);
      if (field) {
        const fieldTyped = field as { name: string; type: string };
        return fieldTyped.type;
      }
    }
    if (typeName.startsWith("{") && typeName.endsWith("}")) {
      const inlineField = this.getInlineObjectField(typeName, fieldName);
      if (inlineField) {
        return inlineField;
      }
    }
    return null;
  }

  private getInlineObjectField(typeStr: string, fieldName: string): string | null {
    const inner = typeStr.slice(1, typeStr.length - 1).trim();
    if (inner.length === 0) return null;
    const fields = this.parseInlineObjectFields(inner);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i] as { name: string; type: string };
      const cleanName = field.name.replace(/\?$/, "");
      if (cleanName === fieldName) {
        return field.type;
      }
    }
    return null;
  }

  private parseInlineObjectFields(inner: string): { name: string; type: string }[] {
    const fields: { name: string; type: string }[] = [];
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
            const name = part.slice(0, colonIdx).trim();
            const fieldType = part.slice(colonIdx + 1).trim();
            fields.push({ name, type: fieldType });
          }
        }
        start = i + 1;
      }
    }
    const lastPart = inner.slice(start).trim();
    if (lastPart) {
      const colonIdx = lastPart.indexOf(":");
      if (colonIdx !== -1) {
        const name = lastPart.slice(0, colonIdx).trim();
        const fieldType = lastPart.slice(colonIdx + 1).trim();
        fields.push({ name, type: fieldType });
      }
    }
    return fields;
  }

  private resolveInterfaceTypeFromExpression(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === "variable") {
      const varName = (expr as VariableNode).name;
      const varType = this.ctx.symbolTable.getType(varName);
      if (varType && varType.startsWith("%") && varType.endsWith("*")) {
        const typeName = varType.substring(1, varType.length - 1);
        if (this.getInterface(typeName)) {
          return typeName;
        }
      }
      return null;
    }
    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      const objectType = this.resolveTypeFromExpression(memberExpr.object);
      if (!objectType) return null;
      const fieldType = this.getFieldTypeFromType(objectType, memberExpr.property);
      if (fieldType) {
        const baseFieldType = fieldType
          .replace(/ \| null$/, "")
          .replace(/ \| undefined$/, "")
          .trim();
        if (this.getInterface(baseFieldType)) {
          return baseFieldType;
        }
      }
    }
    return null;
  }

  isBooleanExpression(expr: Expression | null | undefined): boolean {
    if (expr === null || expr === undefined) return false;
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === "boolean") return true;
    return false;
  }

  isArrayExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    if (e.type === "array") {
      return true;
    }
    if (e.type === "binary") {
      const binExpr = expr as BinaryNode;
      if (binExpr.op === "||" || binExpr.op === "??") {
        const leftIsArray = this.isArrayExpression(binExpr.left);
        const rightIsArray = this.isArrayExpression(binExpr.right);
        const rightBase = binExpr.right as ExprBase;
        if (leftIsArray && rightBase.type === "array") {
          return true;
        }
        if (rightIsArray && leftIsArray) {
          return true;
        }
      }
    }
    if (e.type === "variable") {
      const resolved = this.resolveExpressionType(expr);
      if (
        resolved &&
        resolved.arrayDepth > 0 &&
        (resolved.base === "number" || resolved.base === "boolean")
      ) {
        return true;
      }
      return false;
    }
    return this.isArrayExpressionByType(e, expr);
  }

  private isArrayExpressionByType(e: ExprBase, expr: Expression): boolean {
    if (e.type === "method_call") {
      const methodExpr = expr as MethodCallNode;
      if (
        methodExpr.method === "filter" ||
        methodExpr.method === "map" ||
        methodExpr.method === "entries"
      ) {
        return true;
      }
      if (methodExpr.method === "values") {
        const objBase = methodExpr.object as ExprBase;
        if (objBase.type !== "variable" || (methodExpr.object as VariableNode).name !== "Object") {
          return true;
        }
      }
      if (methodExpr.method === "slice" || methodExpr.method === "concat") {
        const objBase = methodExpr.object as ExprBase;
        if (objBase.type === "array") {
          return true;
        }
        if (objBase.type === "variable") {
          const varName = (methodExpr.object as VariableNode).name;
          if (this.ctx.symbolTable.isNumberArray(varName)) {
            return true;
          }
          const varType = this.ctx.symbolTable.getType(varName);
          if (varType === "%Array*" || varType === "%Array") {
            return true;
          }
        }
      }
      const methodObjBase = methodExpr.object as ExprBase;
      if (methodObjBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith("[]")) return true;
          }
        }
      }
      if (
        methodObjBase.type === "variable" &&
        this.ctx.symbolTable.isClass((methodExpr.object as VariableNode).name)
      ) {
        const className = this.ctx.symbolTable.getClassName(
          (methodExpr.object as VariableNode).name,
        );
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith("[]")) return true;
          }
        }
      }
      return false;
    }
    if (e.type === "call") {
      const rt = this.getCallReturnType(expr);
      if (rt === "number[]" || rt === "boolean[]") return true;
      return false;
    }
    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      if (!memberExpr.object) {
        return false;
      }
      const objBase = memberExpr.object as ExprBase;
      if (!objBase.type) {
        return false;
      }
      if (
        objBase.type === "variable" &&
        this.ctx.symbolTable.isClass((memberExpr.object as VariableNode).name)
      ) {
        const className = this.ctx.symbolTable.getClassName(
          (memberExpr.object as VariableNode).name,
        );
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType === "number[]" || fieldType === "boolean[]") {
            return true;
          }
        }
      }
      if (objBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType === "number[]" || fieldType === "boolean[]") {
            return true;
          }
        }
      }
      if (objBase.type === "variable") {
        const varName = (memberExpr.object as VariableNode).name;
        const paramType = this.getParameterType(varName);
        if (paramType) {
          const fieldType = this.getFieldTypeFromType(paramType, memberExpr.property);
          if (fieldType && fieldType.endsWith("[]")) {
            return true;
          }
        }
        const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType && ifaceType.length > 0) {
          const fieldType = this.getFieldTypeFromType(ifaceType, memberExpr.property);
          if (fieldType && fieldType.endsWith("[]")) {
            return true;
          }
        }
      }
    }
    return false;
  }

  isObjectExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === "object") return true;
    return false;
  }

  isObjectArrayExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    if (e.type === "binary") {
      const binExpr = expr as BinaryNode;
      if (binExpr.op === "||" || binExpr.op === "??") {
        const rightBase = binExpr.right as ExprBase;
        if (rightBase.type === "array") {
          return this.isObjectArrayExpression(binExpr.left);
        }
      }
    }
    if (e.type === "call") {
      const rt = this.getCallReturnType(expr);
      if (rt && rt.endsWith("[]") && rt !== "string[]" && rt !== "number[]" && rt !== "boolean[]") {
        return true;
      }
      return false;
    }
    if (e.type === "variable") {
      const resolved = this.resolveExpressionType(expr);
      if (resolved && resolved.arrayDepth > 0) {
        if (resolved.arrayDepth > 1) {
          return true;
        }
        if (
          resolved.base !== "string" &&
          resolved.base !== "number" &&
          resolved.base !== "boolean"
        ) {
          return true;
        }
      }
      return false;
    }
    return this.isObjectArrayByDispatch(e, expr);
  }

  private isObjectArrayByDispatch(e: ExprBase, expr: Expression): boolean {
    if (e.type === "method_call") {
      const methodExpr = expr as MethodCallNode;
      const methodObjBase = methodExpr.object as ExprBase;
      if (methodObjBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith("[]") && rt !== "string[]" && rt !== "number[]" && rt !== "boolean[]") {
              return true;
            }
          }
        }
      }
      if (methodObjBase.type === "variable") {
        const varName = (methodExpr.object as VariableNode).name;
        let className: string | null = null;
        if (this.ctx.symbolTable.isClass(varName)) {
          className = this.ctx.symbolTable.getClassName(varName) || null;
        } else {
          const paramType = this.getParameterType(varName);
          if (paramType) {
            className = paramType;
          }
        }
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith("[]") && rt !== "string[]" && rt !== "number[]" && rt !== "boolean[]") {
              return true;
            }
          }
        }
      }
      if (methodExpr.method === "entries") {
        if (methodObjBase.type === "variable") {
          const varName = (methodExpr.object as VariableNode).name;
          if (this.ctx.symbolTable.isMap(varName)) return true;
        }
      }
      if (
        methodExpr.method === "slice" ||
        methodExpr.method === "concat" ||
        methodExpr.method === "filter"
      ) {
        if (this.isObjectArrayExpression(methodExpr.object)) {
          return true;
        }
      }
    }
    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      if (!memberExpr.object) {
        return false;
      }
      const objBase = memberExpr.object as ExprBase;
      if (!objBase.type) {
        return false;
      }
      if (
        objBase.type === "variable" &&
        this.ctx.symbolTable.isClass((memberExpr.object as VariableNode).name)
      ) {
        const className = this.ctx.symbolTable.getClassName(
          (memberExpr.object as VariableNode).name,
        );
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (
            fieldType &&
            fieldType.endsWith("[]") &&
            fieldType !== "string[]" &&
            fieldType !== "number[]" &&
            fieldType !== "boolean[]"
          ) {
            return true;
          }
          const tsType = this.ctx.classGenGetFieldTsType(className, memberExpr.property);
          if (
            tsType &&
            tsType.endsWith("[]") &&
            tsType !== "string[]" &&
            tsType !== "number[]" &&
            tsType !== "boolean[]"
          ) {
            return true;
          }
        }
      }
      if (objBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (
            fieldType &&
            fieldType.endsWith("[]") &&
            fieldType !== "string[]" &&
            fieldType !== "number[]" &&
            fieldType !== "boolean[]"
          ) {
            return true;
          }
          const tsType = this.ctx.classGenGetFieldTsType(className, memberExpr.property);
          if (
            tsType &&
            tsType.endsWith("[]") &&
            tsType !== "string[]" &&
            tsType !== "number[]" &&
            tsType !== "boolean[]"
          ) {
            return true;
          }
        }
      }
      if (objBase.type === "variable") {
        const varName = (memberExpr.object as VariableNode).name;
        const paramType = this.getParameterType(varName);
        if (paramType) {
          const fieldType = this.getFieldTypeFromType(paramType, memberExpr.property);
          if (
            fieldType &&
            fieldType.endsWith("[]") &&
            fieldType !== "string[]" &&
            fieldType !== "number[]" &&
            fieldType !== "boolean[]"
          ) {
            return true;
          }
        }
        const ifaceType2 = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType2 && ifaceType2.length > 0) {
          const fieldType = this.getFieldTypeFromType(ifaceType2, memberExpr.property);
          if (
            fieldType &&
            fieldType.endsWith("[]") &&
            fieldType !== "string[]" &&
            fieldType !== "number[]" &&
            fieldType !== "boolean[]"
          ) {
            return true;
          }
        }
        const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
        if (objMeta && objMeta.keys) {
          for (let ki = 0; ki < objMeta.keys.length; ki++) {
            if (objMeta.keys[ki] === memberExpr.property && objMeta.types[ki]) {
              const ft = objMeta.types[ki];
              if (
                ft.endsWith("[]") &&
                ft !== "string[]" &&
                ft !== "number[]" &&
                ft !== "boolean[]"
              ) {
                return true;
              }
            }
          }
        }
      }
      if (objBase.type === "member_access") {
        const nestedMember = memberExpr.object as MemberAccessNode;
        const nestedObjBase = nestedMember.object as ExprBase;
        if (nestedObjBase.type === "this") {
          const className = this.ctx.getCurrentClassName();
          if (className) {
            const fieldTsType = this.ctx.classGenGetFieldTsType(className, nestedMember.property);
            if (fieldTsType) {
              const fieldType = this.getFieldTypeFromType(fieldTsType, memberExpr.property);
              if (
                fieldType &&
                fieldType.endsWith("[]") &&
                fieldType !== "string[]" &&
                fieldType !== "number[]" &&
                fieldType !== "boolean[]"
              ) {
                return true;
              }
            }
          }
        }
        const nestedType = this.resolveNestedMemberAccessTsType(nestedMember);
        if (nestedType) {
          const fieldType = this.getFieldTypeFromType(nestedType, memberExpr.property);
          if (
            fieldType &&
            fieldType.endsWith("[]") &&
            fieldType !== "string[]" &&
            fieldType !== "number[]" &&
            fieldType !== "boolean[]"
          ) {
            return true;
          }
        }
      }
      if (objBase.type === "type_assertion") {
        const assertion = memberExpr.object as TypeAssertionNode;
        if (assertion.assertedType) {
          const fieldType = this.getFieldTypeFromType(assertion.assertedType, memberExpr.property);
          if (
            fieldType &&
            fieldType.endsWith("[]") &&
            fieldType !== "string[]" &&
            fieldType !== "number[]" &&
            fieldType !== "boolean[]"
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  getObjectArrayElementType(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === "binary") {
      const binExpr = expr as BinaryNode;
      if (binExpr.op === "||" || binExpr.op === "??") {
        return this.getObjectArrayElementType(binExpr.left);
      }
    }
    if (e.type === "method_call") {
      const methodExpr = expr as MethodCallNode;
      const methodObjBase = methodExpr.object as ExprBase;
      if (methodObjBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith("[]") && rt !== "string[]" && rt !== "number[]" && rt !== "boolean[]") {
              return rt.slice(0, -2);
            }
          }
        }
      }
      if (methodObjBase.type === "variable") {
        const varName = (methodExpr.object as VariableNode).name;
        let className: string | null = null;
        if (this.ctx.symbolTable.isClass(varName)) {
          className = this.ctx.symbolTable.getClassName(varName) || null;
        } else {
          const paramType = this.getParameterType(varName);
          if (paramType) {
            className = paramType;
          }
        }
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType) {
            const rt = stripNullable(method.returnType);
            if (rt.endsWith("[]") && rt !== "string[]" && rt !== "number[]" && rt !== "boolean[]") {
              return rt.slice(0, -2);
            }
          }
        }
      }
    }
    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      if (!memberExpr.object) {
        return null;
      }
      const objBase = memberExpr.object as ExprBase;
      if (!objBase.type) {
        return null;
      }
      if (objBase.type === "variable") {
        const varName = (memberExpr.object as VariableNode).name;
        const paramType = this.getParameterType(varName);
        if (paramType) {
          const fieldType = this.getFieldTypeFromType(paramType, memberExpr.property);
          if (
            fieldType &&
            fieldType.endsWith("[]") &&
            fieldType !== "string[]" &&
            fieldType !== "number[]" &&
            fieldType !== "boolean[]"
          ) {
            return fieldType.slice(0, -2);
          }
        }
        const ifaceType3 = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType3 && ifaceType3.length > 0) {
          const fieldType = this.getFieldTypeFromType(ifaceType3, memberExpr.property);
          if (
            fieldType &&
            fieldType.endsWith("[]") &&
            fieldType !== "string[]" &&
            fieldType !== "number[]" &&
            fieldType !== "boolean[]"
          ) {
            return fieldType.slice(0, -2);
          }
        }
      }
      const objectType = this.resolveTypeFromExpression(memberExpr.object);
      if (objectType) {
        const fieldType = this.getFieldTypeFromType(objectType, memberExpr.property);
        if (fieldType) {
          const baseFieldType = stripNullable(fieldType);
          if (
            baseFieldType.endsWith("[]") &&
            baseFieldType !== "string[]" &&
            baseFieldType !== "number[]" &&
            baseFieldType !== "boolean[]"
          ) {
            return baseFieldType.slice(0, -2);
          }
        }
      }
    }
    return null;
  }

  isMapExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base.startsWith("Map<")) return true;
    return false;
  }

  isSetExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base.startsWith("Set<")) return true;
    return false;
  }

  isStringExpression(expr: Expression): boolean {
    if (!expr) return false;
    const e = expr as ExprBase;
    if (!e.type) return false;
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === "string" && resolved.arrayDepth === 0) return true;
    if (resolved) return false;

    if (e.type === "binary") {
      const binaryExpr = expr as BinaryNode;
      if (binaryExpr.op === "||" || binaryExpr.op === "??") {
        return (
          this.isStringExpression(binaryExpr.left) || this.isStringExpression(binaryExpr.right)
        );
      }
    }
    if (e.type === "index_access") {
      const indexExpr = expr as IndexAccessNode;
      const idxObjBase = indexExpr.object as ExprBase;
      if (idxObjBase.type === "member_access") {
        const memberAccess = indexExpr.object as MemberAccessNode;
        const memberObjBase = memberAccess.object as ExprBase;
        if (
          memberObjBase.type === "variable" &&
          (memberAccess.object as VariableNode).name === "process" &&
          memberAccess.property === "argv"
        ) {
          return true;
        }
      }
      if (idxObjBase.type === "variable") {
        const varName = (indexExpr.object as VariableNode).name;
        const varType = this.ctx.symbolTable.getType(varName);
        if (varType === "%StringArray*" || varType === "%StringArray") {
          return true;
        }
        if (varType === "i8*") {
          if (
            ((this.ctx.symbolTable.isObject(varName) || this.ctx.symbolTable.isJSON(varName)) &&
              this.ctx.symbolTable.getObjectMetadataKeys(varName) !== undefined) ||
            this.ctx.symbolTable.getInterfaceType(varName)
          ) {
            return false;
          }
          return true;
        }
      }
      if (idxObjBase.type === "member_access") {
        const memberAccess = indexExpr.object as MemberAccessNode;
        const memberObjBase = memberAccess.object as ExprBase;
        if (memberObjBase.type === "this") {
          const className = this.ctx.getCurrentClassName();
          if (className) {
            const fieldType = this.ctx.classGenGetFieldType(className, memberAccess.property);
            if (fieldType === "string[]") {
              return true;
            }
          }
        }
        if (
          memberObjBase.type === "variable" &&
          this.ctx.symbolTable.isClass((memberAccess.object as VariableNode).name)
        ) {
          const className = this.ctx.symbolTable.getClassName(
            (memberAccess.object as VariableNode).name,
          );
          if (className) {
            const fieldType = this.ctx.classGenGetFieldType(className, memberAccess.property);
            if (fieldType === "string[]") {
              return true;
            }
          }
        }
      }
    }
    if (e.type === "method_call") {
      const methodExpr = expr as MethodCallNode;
      if (
        (methodExpr.method === "slice" || methodExpr.method === "concat") &&
        !this.isArrayExpression(methodExpr.object) &&
        !this.isStringArrayExpression(methodExpr.object)
      ) {
        return true;
      }
    }
    if (e.type === "conditional") {
      const condExpr = expr as ConditionalExpressionNode;
      return (
        this.isStringExpression(condExpr.consequent) || this.isStringExpression(condExpr.alternate)
      );
    }
    return false;
  }

  isRegexExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === "RegExp") return true;
    return false;
  }

  isClassInstanceExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved) {
      if (
        resolved.base === "Promise" ||
        resolved.base === "RegExp" ||
        resolved.base === "Uint8Array" ||
        resolved.base === "Date" ||
        resolved.base === "URL" ||
        resolved.base === "URLSearchParams"
      )
        return false;
      if (
        resolved.base === "string" ||
        resolved.base === "number" ||
        resolved.base === "boolean" ||
        resolved.base === "void" ||
        resolved.base === "null" ||
        resolved.base === "unknown" ||
        resolved.base === "object" ||
        resolved.base === "Response"
      )
        return false;
      if (resolved.base.startsWith("Map<") || resolved.base.startsWith("Set<")) return false;
      if (resolved.arrayDepth > 0) return false;
      const cls = this.getClass(resolved.base);
      if (cls) return true;
    }
    const e = expr as ExprBase;
    if (e.type === "new") {
      const newExpr = expr as NewNode;
      if (this.isBuiltinClassName(newExpr.className)) return false;
      return true;
    }
    return false;
  }

  private isBuiltinClassName(className: string): boolean {
    if (className === "Promise") return true;
    if (className === "RegExp") return true;
    if (className === "Uint8Array") return true;
    if (className === "Date") return true;
    return className === "URL" || className === "URLSearchParams";
  }

  isUint8ArrayExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === "Uint8Array" && resolved.arrayDepth === 0) return true;
    const e = expr as ExprBase;
    if (e.type === "new") {
      const newExpr = expr as NewNode;
      if (newExpr.className === "Uint8Array") return true;
    }
    if (e.type === "variable") {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isUint8Array(varName)) return true;
    }
    // ChadScript.getEmbeddedFileAsUint8Array() returns Uint8Array
    if (e.type === "method_call") {
      const mc = expr as MethodCallNode;
      if (mc.method === "getEmbeddedFileAsUint8Array") return true;
      if (mc.method === "bodyBytes") return true;
      if (mc.method === "fromRawBytes") return true;
    }
    return false;
  }

  isPromiseExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === "Promise") return true;
    const e = expr as ExprBase;
    if (e.type === "call" && (expr as CallNode).name === "fetch") {
      return true;
    }
    if (e.type === "method_call") {
      const methodExpr = expr as MethodCallNode;
      const objBase = methodExpr.object as ExprBase;
      if (objBase.type === "variable" && (methodExpr.object as VariableNode).name === "Promise") {
        return true;
      }
      if (methodExpr.method === "then" || methodExpr.method === "catch") {
        return this.isPromiseExpression(methodExpr.object);
      }
    }
    if (e.type === "call") {
      const func = this.getFunction((expr as CallNode).name);
      if (func && func.async) {
        return true;
      }
    }
    return false;
  }

  isResponseExpression(expr: Expression): boolean {
    const resolved = this.resolveExpressionType(expr);
    if (resolved && resolved.base === "Response") return true;
    return false;
  }

  getTypedJsonInterface(expr: MethodCallNode): string | null {
    const e = expr as ExprBase;
    if (e.type === "method_call" && expr.method === "json" && expr.typeParameter) {
      return expr.typeParameter;
    }
    if (e.type === "method_call" && expr.method === "parse" && expr.typeParameter) {
      const objBase = expr.object as ExprBase;
      if (objBase && objBase.type === "variable") {
        const varNode = expr.object as VariableNode;
        if (varNode.name === "JSON") {
          const tp = expr.typeParameter;
          if (tp !== "number[]" && tp !== "string" && tp !== "number" && tp !== "boolean") {
            return tp;
          }
        }
      }
    }
    return null;
  }

  getFunctionCallInterfaceReturn(expr: Expression): string | null {
    const e = expr as ExprBase;

    if (e.type === "conditional") {
      const condExpr = expr as ConditionalExpressionNode;
      const consequentResult = this.getFunctionCallInterfaceReturn(condExpr.consequent);
      if (consequentResult) return consequentResult;
      const alternateResult = this.getFunctionCallInterfaceReturn(condExpr.alternate);
      if (alternateResult) return alternateResult;
      return null;
    }

    if (e.type !== "call") return null;
    const callExpr = expr as CallNode;
    const func = this.getFunction(callExpr.name);
    if (!func || !func.returnType) return null;

    let returnType = func.returnType;

    if (returnType.indexOf(" | ") !== -1) {
      const parts = returnType.split(" | ");
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part !== "null" && part !== "undefined") {
          if (part.startsWith("{")) {
            return part;
          }
          const iface = this.getInterface(part);
          if (iface) return part;
        }
      }
    }

    if (returnType.startsWith("{")) {
      return returnType;
    }

    const iface = this.getInterface(returnType);
    if (iface) return returnType;
    return null;
  }

  getIndexAccessElementType(expr: Expression): string | null {
    let e = expr as ExprBase;
    let indexExpr: Expression = expr;
    if (e.type === "type_assertion") {
      const assertion = expr as TypeAssertionNode;
      if (assertion.expression) {
        indexExpr = assertion.expression;
        e = assertion.expression as ExprBase;
      }
    }
    if (e.type !== "index_access") return null;
    const idxNode = indexExpr as IndexAccessNode;
    const objBase = idxNode.object as ExprBase;
    if (objBase.type === "variable") {
      const varName = (idxNode.object as VariableNode).name;
      const objMeta5 = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objMeta5 && objMeta5.tsTypes) {
        return null;
      }
      const ifaceType5 = this.ctx.symbolTable.getInterfaceType(varName);
      if (ifaceType5) {
        const baseType = ifaceType5.replace("[]", "");
        const iface = this.getInterface(baseType);
        if (iface) return baseType;
      }
      const objArrElemType = this.ctx.symbolTable.getRawInterfaceType(varName);
      if (objArrElemType) {
        const iface = this.getInterface(objArrElemType);
        if (iface) return objArrElemType;
      }
    }
    return null;
  }

  getMethodCallInterfaceReturn(expr: Expression): string | null {
    const e = expr as ExprBase;

    if (e.type === "type_assertion") {
      const assertion = expr as TypeAssertionNode;
      if (assertion.assertedType.startsWith("{")) {
        return assertion.assertedType;
      }
      const iface = this.getInterface(assertion.assertedType);
      if (iface) return assertion.assertedType;
      return this.getMethodCallInterfaceReturn(assertion.expression);
    }

    if (e.type === "conditional") {
      const condExpr = expr as ConditionalExpressionNode;
      const consequentResult = this.getMethodCallInterfaceReturn(condExpr.consequent);
      if (consequentResult) return consequentResult;
      const alternateResult = this.getMethodCallInterfaceReturn(condExpr.alternate);
      if (alternateResult) return alternateResult;
      return null;
    }

    if (e.type !== "method_call") return null;
    const methodExpr = expr as MethodCallNode;

    const className = this.resolveClassNameFromExpression(methodExpr.object);

    if (className) {
      const method = this.getClassMethod(className, methodExpr.method);
      if (method && method.returnType) {
        let returnType = method.returnType;
        if (returnType.indexOf(" | ") !== -1) {
          const parts = returnType.split(" | ");
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            if (part !== "null" && part !== "undefined") {
              if (part.startsWith("{") && !part.endsWith("[]")) {
                return part;
              }
              const iface = this.getInterface(part);
              if (iface) return part;
            }
          }
        }

        if (returnType.startsWith("{") && !stripNullable(returnType).endsWith("[]")) {
          return returnType;
        }

        const iface = this.getInterface(returnType);
        if (iface) return returnType;
        if (
          returnType === "HttpResponse" ||
          returnType === "HttpRequest" ||
          returnType === "WsEvent" ||
          returnType === "MultipartPart"
        ) {
          return returnType;
        }
      }
    }

    const interfaceType = this.resolveInterfaceTypeFromExpression(methodExpr.object);
    if (interfaceType) {
      const methodReturnType = this.getInterfaceMethodReturnType(interfaceType, methodExpr.method);
      if (methodReturnType) {
        let returnType = methodReturnType;
        if (returnType.indexOf(" | ") !== -1) {
          const parts = returnType.split(" | ");
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            if (part !== "null" && part !== "undefined") {
              if (part.startsWith("{") && !part.endsWith("[]")) {
                return part;
              }
              const iface = this.getInterface(part);
              if (iface) return part;
            }
          }
        }

        if (returnType.startsWith("{") && !stripNullable(returnType).endsWith("[]")) {
          return returnType;
        }

        const iface = this.getInterface(returnType);
        if (iface) return returnType;
      }
    }

    return null;
  }

  getMethodCallArrayReturn(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type !== "method_call") return null;
    const methodExpr = expr as MethodCallNode;

    const className = this.resolveClassNameFromExpression(methodExpr.object);

    if (className) {
      const method = this.getClassMethod(className, methodExpr.method);
      if (method && method.returnType) {
        const rt = stripNullable(method.returnType);
        if (rt.endsWith("[]")) {
          const elementTypeName = rt.slice(0, -2).trim();
          if (
            elementTypeName === "string" ||
            elementTypeName === "number" ||
            elementTypeName === "boolean"
          ) {
            return null;
          }
          return elementTypeName;
        }
      }
    }

    return null;
  }

  private parseInlineObjectType(typeStr: string): { name: string; type: string }[] | null {
    if (!typeStr.startsWith("{") || !typeStr.endsWith("}")) {
      return null;
    }
    const inner = typeStr.slice(1, typeStr.length - 1).trim();
    if (inner.length === 0) {
      return [];
    }
    const fields: { name: string; type: string }[] = [];
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
            const name = part.slice(0, colonIdx).trim();
            const fieldType = part.slice(colonIdx + 1).trim();
            fields.push({ name, type: fieldType });
          }
        }
        start = i + 1;
      }
    }
    const lastPart = inner.slice(start).trim();
    if (lastPart) {
      const colonIdx = lastPart.indexOf(":");
      if (colonIdx !== -1) {
        const name = lastPart.slice(0, colonIdx).trim();
        const fieldType = lastPart.slice(colonIdx + 1).trim();
        fields.push({ name, type: fieldType });
      }
    }
    return fields;
  }

  getJSONParseInterface(expr: MethodCallNode): string | null {
    const e = expr as ExprBase;
    if (
      e.type === "method_call" &&
      expr.method === "parse" &&
      expr.object !== null &&
      expr.object !== undefined
    ) {
      const exprObj = expr.object as ExprBase;
      if (
        exprObj.type === "variable" &&
        (expr.object as VariableNode).name === "JSON" &&
        expr.typeParameter
      ) {
        return expr.typeParameter;
      }
    }
    return null;
  }

  isJSONParseExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    if (e.type === "method_call") {
      const methodCall = expr as MethodCallNode;
      const objBase = methodCall.object as ExprBase;
      return (
        methodCall.method === "parse" &&
        objBase.type === "variable" &&
        (methodCall.object as VariableNode).name === "JSON"
      );
    }
    if (e.type === "variable") {
      return this.ctx.symbolTable.isJSON((expr as VariableNode).name);
    }
    return false;
  }

  isStringArrayExpression(expr: Expression): boolean {
    const e = expr as ExprBase;
    if (e.type === "binary") {
      const binExpr = expr as BinaryNode;
      if (binExpr.op === "||" || binExpr.op === "??") {
        const leftIsStringArray = this.isStringArrayExpression(binExpr.left);
        const rightBase = binExpr.right as ExprBase;
        if (leftIsStringArray && rightBase.type === "array") {
          return true;
        }
        if (leftIsStringArray && this.isStringArrayExpression(binExpr.right)) {
          return true;
        }
      }
    }
    if (e.type === "type_assertion") {
      const assertion = expr as TypeAssertionNode;
      if (assertion.assertedType === "string[]") {
        return true;
      }
      return this.isStringArrayExpression(assertion.expression);
    }
    if (e.type === "call") {
      const rt = this.getCallReturnType(expr);
      if (rt === "string[]") return true;
      return false;
    }
    if (e.type === "variable") {
      const resolved = this.resolveExpressionType(expr);
      if (resolved && resolved.arrayDepth === 1 && resolved.base === "string") {
        return true;
      }
      return false;
    }
    if (e.type === "array") {
      const arrayExpr = expr as ArrayNode;
      const elements = arrayExpr.elements || [];
      if (elements.length === 0 && this.ctx.getExpectedArrayElementType() === "string") {
        return true;
      }
      if (elements.length === 0) {
        return false;
      }
      for (let i = 0; i < elements.length; i++) {
        const elem = elements[i];
        const elemBase = elem as ExprBase;
        if (elemBase.type === "string") {
          continue;
        }
        if (elemBase.type === "variable") {
          const varName = (elem as VariableNode).name;
          if (this.ctx.symbolTable.isString(varName)) {
            continue;
          }
          const varType = this.ctx.symbolTable.getType(varName);
          if (varType === "i8*") {
            continue;
          }
          return false;
        }
        if (this.isStringExpression(elem)) {
          continue;
        }
        return false;
      }
      return true;
    }
    if (e.type === "method_call") {
      const methodExpr = expr as MethodCallNode;
      if (methodExpr.method === "split") {
        return true;
      }
      if (methodExpr.method === "all") {
        const objBase = methodExpr.object as ExprBase;
        if (objBase.type === "variable" && (methodExpr.object as VariableNode).name === "sqlite") {
          return true;
        }
      }
      if (methodExpr.method === "keys") {
        const objBase = methodExpr.object as ExprBase;
        if (objBase.type === "variable" && (methodExpr.object as VariableNode).name === "Object") {
          return true;
        }
        if (objBase.type === "variable") {
          const varName = (methodExpr.object as VariableNode).name;
          if (this.ctx.symbolTable.isMap(varName)) {
            const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
            if (mapMeta && mapMeta.keyType === "string") {
              return true;
            }
          }
        }
      }
      if (methodExpr.method === "values" || methodExpr.method === "entries") {
        const objBase = methodExpr.object as ExprBase;
        if (objBase.type === "variable" && (methodExpr.object as VariableNode).name === "Object") {
          if (methodExpr.method === "entries") {
            return true;
          }
          if (methodExpr.args.length > 0) {
            const argBase = methodExpr.args[0] as ExprBase;
            if (argBase.type === "variable") {
              const argName = (methodExpr.args[0] as VariableNode).name;
              const objInfo = this.ctx.symbolTable.getObjectInfo(argName);
              if (objInfo) {
                const allNumbers = objInfo.types.every((t: string) => t === "double");
                if (!allNumbers) return true;
              }
            }
          }
        }
      }
      if (
        methodExpr.method === "match" &&
        this.isStringExpression(methodExpr.object) &&
        !this.isClassInstanceExpression(methodExpr.object)
      ) {
        if (
          methodExpr.args.length > 0 &&
          (methodExpr.args[0].type === "regex" || this.isRegexExpression(methodExpr.args[0]))
        ) {
          return true;
        }
      }
      if (
        (methodExpr.method === "exec" || methodExpr.method === "execDyn") &&
        this.isRegexExpression(methodExpr.object)
      ) {
        return true;
      }
      if (
        methodExpr.method === "map" ||
        methodExpr.method === "filter" ||
        methodExpr.method === "slice" ||
        methodExpr.method === "concat"
      ) {
        return this.isStringArrayExpression(methodExpr.object);
      }
      const objBase = methodExpr.object as ExprBase;
      if (objBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType === "string[]") {
            return true;
          }
        }
      }
      if (
        objBase.type === "variable" &&
        this.ctx.symbolTable.isClass((methodExpr.object as VariableNode).name)
      ) {
        const className = this.ctx.symbolTable.getClassName(
          (methodExpr.object as VariableNode).name,
        );
        if (className) {
          const method = this.getClassMethod(className, methodExpr.method);
          if (method && method.returnType === "string[]") {
            return true;
          }
        }
      }
      return false;
    }
    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      if (!memberExpr.object) {
        return false;
      }
      const objBase = memberExpr.object as ExprBase;
      if (!objBase.type) {
        return false;
      }
      if (
        objBase.type === "variable" &&
        (memberExpr.object as VariableNode).name === "process" &&
        memberExpr.property === "argv"
      ) {
        return true;
      }
      if (
        objBase.type === "variable" &&
        this.ctx.symbolTable.isClass((memberExpr.object as VariableNode).name)
      ) {
        const className = this.ctx.symbolTable.getClassName(
          (memberExpr.object as VariableNode).name,
        );
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType === "string[]") {
            return true;
          }
        }
      }
      if (objBase.type === "variable") {
        const varName = (memberExpr.object as VariableNode).name;
        const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType) {
          const prop = this.getInterfaceProperty(ifaceType, memberExpr.property);
          if (prop && prop.type === "string[]") {
            return true;
          }
        }
      }
      if (
        objBase.type === "variable" &&
        this.ctx.symbolTable.isObject((memberExpr.object as VariableNode).name)
      ) {
        const varName = (memberExpr.object as VariableNode).name;
        const objInfo = this.ctx.symbolTable.getObjectInfo(varName);
        if (objInfo && objInfo.tsTypes) {
          const propIdx = objInfo.keys.indexOf(memberExpr.property);
          if (propIdx >= 0 && objInfo.tsTypes[propIdx] === "string[]") {
            return true;
          }
        }
      }
      if (objBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldType = this.ctx.classGenGetFieldType(className, memberExpr.property);
          if (fieldType === "string[]") {
            return true;
          }
        }
      }
      if (objBase.type === "member_access") {
        const nestedMemberTsType = this.resolveNestedMemberAccessTsType(
          memberExpr.object as MemberAccessNode,
        );
        if (nestedMemberTsType) {
          const fieldProp = this.getInterfaceProperty(nestedMemberTsType, memberExpr.property);
          if (fieldProp && fieldProp.type === "string[]") {
            return true;
          }
          if (
            !fieldProp &&
            nestedMemberTsType.endsWith("Metadata") &&
            (memberExpr.property === "keys" ||
              memberExpr.property === "types" ||
              memberExpr.property === "tsTypes")
          ) {
            return true;
          }
        } else {
          const nestedMember = memberExpr.object as MemberAccessNode;
          if (
            nestedMember.property === "objectMetadata" &&
            (memberExpr.property === "keys" ||
              memberExpr.property === "types" ||
              memberExpr.property === "tsTypes")
          ) {
            return true;
          }
        }
      }
      if (objBase.type === "type_assertion") {
        const assertion = memberExpr.object as TypeAssertionNode;
        if (assertion.assertedType) {
          const fieldType = this.getFieldTypeFromType(assertion.assertedType, memberExpr.property);
          if (fieldType === "string[]") {
            return true;
          }
        }
      }
    }
    if (e.type === "call") {
      const funcExpr = expr as CallNode;
      if (funcExpr.name) {
        const func = this.getFunction(funcExpr.name);
        if (func && func.returnType) {
          let normalizedRetType = func.returnType;
          if (normalizedRetType.indexOf(" | ") !== -1) {
            normalizedRetType = normalizedRetType
              .replace(" | undefined", "")
              .replace(" | null", "")
              .trim();
          }
          if (normalizedRetType === "string[]") {
            return true;
          }
        }
      }
    }
    return false;
  }

  private resolveNestedMemberAccessTsType(memberExpr: MemberAccessNode): string | null {
    const objBase = memberExpr.object as ExprBase;
    if (objBase.type === "variable") {
      const varName = (memberExpr.object as VariableNode).name;
      if (this.ctx.symbolTable.isObject(varName)) {
        const objInfo = this.ctx.symbolTable.getObjectInfo(varName);
        if (objInfo && objInfo.tsTypes) {
          const propIdx = objInfo.keys.indexOf(memberExpr.property);
          if (propIdx >= 0) {
            return objInfo.tsTypes[propIdx];
          }
        }
      }
      if (this.ctx.symbolTable.isClass(varName)) {
        const className = this.ctx.symbolTable.getClassName(varName);
        if (className) {
          return this.ctx.classGenGetFieldTsType(className, memberExpr.property);
        }
      }
      const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
      if (ifaceType) {
        const prop = this.getInterfaceProperty(ifaceType, memberExpr.property);
        if (prop) {
          return prop.type;
        }
      }
    }
    if (objBase.type === "this") {
      const className = this.ctx.getCurrentClassName();
      if (className) {
        return this.ctx.classGenGetFieldTsType(className, memberExpr.property);
      }
    }
    if (objBase.type === "member_access") {
      const nestedType = this.resolveNestedMemberAccessTsType(
        memberExpr.object as MemberAccessNode,
      );
      if (nestedType) {
        const prop = this.getInterfaceProperty(nestedType, memberExpr.property);
        if (prop) {
          return prop.type;
        }
      }
    }
    return null;
  }

  private returnTypeIsString(returnType: string): boolean {
    if (returnType === "string") return true;
    // FFI pointer types map to i8* like strings
    if (returnType === "i8_ptr" || returnType === "ptr") return true;
    if (returnType.indexOf(" | ") !== -1) {
      const parts = returnType.split(" | ");
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part === "string") return true;
        if (part !== "undefined" && part !== "null" && this.isStringEnum(part)) return true;
      }
    }
    if (this.isStringEnum(returnType)) return true;
    return false;
  }

  private isStringEnum(typeName: string): boolean {
    return false;
  }
}
