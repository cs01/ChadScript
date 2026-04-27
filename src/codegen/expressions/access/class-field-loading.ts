import type { InterfaceField, InterfaceDeclaration } from "../../../ast/types.js";
import type { InterfaceFieldInfo } from "../../types/interface-struct-generator.js";
import type { MemberAccessGeneratorContext } from "./member.js";
import type { FieldInfo } from "../../infrastructure/type-resolver/types.js";
import {
  stripOptional,
  stripNullable,
  tsTypeToLlvm,
  isAnyArrayTsType,
  classifyArray,
  arrayKindToLlvm,
} from "../../infrastructure/type-system.js";
import { parseInlineObjectTypeForAssertion } from "./type-assertion-access.js";

export function loadFieldValue(
  ctx: MemberAccessGeneratorContext,
  fieldPtr: string,
  fieldInfo: FieldInfo,
  className?: string,
  fieldName?: string,
): string {
  let fieldType = fieldInfo.type;
  let tsType = fieldInfo.tsType;
  if (className && fieldName) {
    const ft = ctx.classGenGetFieldType(className, fieldName);
    const tst = ctx.classGenGetFieldTsType(className, fieldName);
    if (ft) fieldType = ft;
    if (tst) tsType = tst;
  }
  const primitive = loadPrimitiveFieldValue(ctx, fieldPtr, fieldType, tsType);
  if (primitive) return primitive;
  const collection = loadCollectionFieldValue(ctx, fieldPtr, fieldType, tsType);
  if (collection) return collection;
  return loadFallbackFieldValue(ctx, fieldPtr, fieldType, tsType);
}

export function loadPrimitiveFieldValue(
  ctx: MemberAccessGeneratorContext,
  fieldPtr: string,
  fieldType: string,
  tsType: string | undefined,
): string | null {
  if (fieldType === "string") {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
    ctx.setVariableType(value, "i8*");
    if (tsType) {
      storeInterfaceMetadata(ctx, value, tsType);
      if (
        tsType !== "string" &&
        tsType !== "number" &&
        tsType !== "boolean" &&
        tsType.indexOf("|") === -1 &&
        tsType.indexOf("[") === -1
      ) {
        let concreteClass = ctx.findClassImplementingInterface(tsType);
        if (!concreteClass) {
          const ifaceDef = ctx.getInterfaceDeclByName(tsType);
          if (ifaceDef) {
            const allFields = ctx.getAllInterfaceFields(ifaceDef);
            const fieldNames: string[] = [];
            for (let fi = 0; fi < allFields.length; fi++) {
              const f = allFields[fi] as InterfaceField;
              fieldNames.push(f.name);
            }
            if (fieldNames.length > 0) {
              concreteClass = resolveConcreteClassByFields(ctx, fieldNames, fieldNames[0]);
            }
          }
        }
        if (concreteClass) {
          ctx.setActualClassType(value, concreteClass);
        }
      }
    }
    return value;
  } else if (fieldType === "string[]") {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
    ctx.setVariableType(value, "%StringArray*");
    return value;
  } else if (isAnyArrayTsType(fieldType)) {
    const resolvedTsType = tsType || fieldType;
    const llvmT = arrayKindToLlvm(classifyArray(resolvedTsType));
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load ${llvmT}, ${llvmT}* ${fieldPtr}`);
    ctx.setVariableType(value, llvmT);
    return value;
  } else if (fieldType === "boolean") {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load double, double* ${fieldPtr}`);
    ctx.setVariableType(value, "double");
    return value;
  }
  return null;
}

export function loadCollectionFieldValue(
  ctx: MemberAccessGeneratorContext,
  fieldPtr: string,
  fieldType: string,
  tsType: string | undefined,
): string | null {
  if (tsType && tsType.startsWith("Map<string,")) {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load %StringMap*, %StringMap** ${fieldPtr}`);
    ctx.setVariableType(value, "%StringMap*");
    return value;
  } else if (tsType && tsType.startsWith("Map<")) {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load %Map*, %Map** ${fieldPtr}`);
    ctx.setVariableType(value, "%Map*");
    return value;
  } else if (tsType === "Set<string>") {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load %StringSet*, %StringSet** ${fieldPtr}`);
    ctx.setVariableType(value, "%StringSet*");
    return value;
  } else if (tsType && tsType.startsWith("Set<")) {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load %Set*, %Set** ${fieldPtr}`);
    ctx.setVariableType(value, "%Set*");
    return value;
  }
  return null;
}

export function loadFallbackFieldValue(
  ctx: MemberAccessGeneratorContext,
  fieldPtr: string,
  fieldType: string,
  tsType: string | undefined,
): string {
  if (
    (fieldType === "double" || fieldType === "number") &&
    (!tsType || tsType === "number" || tsType === "boolean")
  ) {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load double, double* ${fieldPtr}`);
    ctx.setVariableType(value, "double");
    return value;
  } else if (tsType && isAnyArrayTsType(tsType)) {
    const llvmT = arrayKindToLlvm(classifyArray(tsType));
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load ${llvmT}, ${llvmT}* ${fieldPtr}`);
    ctx.setVariableType(value, llvmT);
    return value;
  }
  const value = ctx.nextTemp();
  let cleanTsType = tsType || "";
  if (cleanTsType.indexOf(" | ") !== -1) {
    cleanTsType = stripNullable(cleanTsType);
  }
  const classNode = ctx.classGenGetClassFields(cleanTsType);
  if (classNode.length > 0) {
    const structType = `%${cleanTsType}_struct*`;
    ctx.emit(`${value} = load ${structType}, ${structType}* ${fieldPtr}`);
    ctx.setVariableType(value, structType);
    ctx.setActualClassType(value, cleanTsType);
  } else {
    ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
    ctx.setVariableType(value, "i8*");
    if (tsType) {
      let isKnownClass = false;
      const classCount = ctx.getClassesCount();
      for (let ci = 0; ci < classCount; ci++) {
        const classNode = ctx.getAstClassAt(ci);
        if (classNode && classNode.name === cleanTsType) {
          isKnownClass = true;
          break;
        }
      }
      if (isKnownClass) {
        ctx.setActualClassType(value, cleanTsType);
      } else {
        storeInterfaceMetadata(ctx, value, cleanTsType);
        const concreteClass = ctx.findClassImplementingInterface(cleanTsType);
        if (concreteClass) {
          ctx.setActualClassType(value, concreteClass);
        } else {
          const structuralMatch = findStructuralClassForField(ctx, cleanTsType);
          if (structuralMatch) {
            ctx.setActualClassType(value, structuralMatch);
          }
        }
      }
    }
  }
  return value;
}

export function storeInterfaceMetadata(
  ctx: MemberAccessGeneratorContext,
  register: string,
  tsType: string,
): void {
  let lookupType = tsType;
  if (lookupType.indexOf(" | ") !== -1) {
    lookupType = stripNullable(lookupType);
  }
  if (ctx.interfaceStructGen?.hasInterface(lookupType)) {
    const interfaceInfo = ctx.interfaceStructGen?.getInterfaceStruct(lookupType);
    if (interfaceInfo) {
      const keys: string[] = [];
      const tsTypes: string[] = [];
      const types: string[] = [];
      const fields = interfaceInfo.fields as InterfaceFieldInfo[];
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i] as InterfaceFieldInfo;
        keys.push(f.name);
        tsTypes.push(f.tsType);
        types.push(f.llvmType);
      }
      ctx.setJsonObjectMetadata(register, { keys, types, tsTypes, interfaceType: tsType });
      return;
    }
  }
  const interfaceDefResult = ctx.getInterfaceDeclByName(lookupType);
  if (interfaceDefResult) {
    const interfaceDef = interfaceDefResult as InterfaceDeclaration;
    const keys: string[] = [];
    const tsTypes: string[] = [];
    const types: string[] = [];
    const allFields = ctx.getAllInterfaceFields(interfaceDef);
    for (let i = 0; i < allFields.length; i++) {
      const f = allFields[i] as InterfaceField;
      keys.push(stripOptional(f.name));
      tsTypes.push(f.type);
      types.push(tsTypeToLlvm(f.type));
    }
    ctx.setJsonObjectMetadata(register, { keys, types, tsTypes, interfaceType: undefined });
  } else if (lookupType === "Expression" || lookupType === "Statement") {
    ctx.setJsonObjectMetadata(register, {
      keys: ["type"],
      types: ["i8*"],
      tsTypes: ["string"],
      interfaceType: undefined,
    });
  } else {
    let strippedType = tsType;
    if (strippedType.includes(" | ")) {
      const parts = strippedType.split(" | ");
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i].trim();
        if (p.startsWith("{")) {
          strippedType = p;
          break;
        }
      }
    }
    if (strippedType.startsWith("{") && strippedType.endsWith("}")) {
      const inlineFields = parseInlineObjectTypeForAssertion(strippedType);
      if (inlineFields && inlineFields.length > 0) {
        const keys: string[] = [];
        const tsTypes: string[] = [];
        const types: string[] = [];
        for (let i = 0; i < inlineFields.length; i++) {
          const f = inlineFields[i] as InterfaceField;
          keys.push(f.name);
          tsTypes.push(f.type);
          types.push(tsTypeToLlvm(f.type));
        }
        ctx.setJsonObjectMetadata(register, {
          keys,
          types,
          tsTypes,
          interfaceType: undefined,
        });
      }
    }
  }
}

export function resolveConcreteClassByFields(
  ctx: MemberAccessGeneratorContext,
  interfaceKeys: string[],
  targetProperty: string,
): string | null {
  const classCount = ctx.getClassesCount();
  let bestMatch: string | null = null;
  let bestMatchCount = 0;
  for (let i = 0; i < classCount; i++) {
    const cls = ctx.getAstClassAt(i);
    if (!cls || !cls.name || !cls.fields) continue;
    const fieldInfo = ctx.classGenGetFieldInfo(cls.name, targetProperty);
    if (!fieldInfo) continue;
    let matchCount = 0;
    for (let k = 0; k < interfaceKeys.length; k++) {
      const key = interfaceKeys[k];
      if (ctx.classGenGetFieldInfo(cls.name, key)) {
        matchCount++;
      }
    }
    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      bestMatch = cls.name;
    }
  }
  if (bestMatch && bestMatchCount >= 3) {
    return bestMatch;
  }
  return null;
}

export function findStructuralClassForField(
  ctx: MemberAccessGeneratorContext,
  interfaceName: string,
): string | null {
  const props = ctx.getInterfaceProperties(interfaceName);
  if (!props || props.keys.length === 0) return null;
  const classCount = ctx.getClassesCount();
  let bestMatch: string | null = null;
  let bestCount = 0;
  for (let i = 0; i < classCount; i++) {
    const cls = ctx.getAstClassAt(i);
    if (!cls || !cls.name) continue;
    if (cls.name.indexOf("Mock") !== -1 || cls.name.indexOf("Test") !== -1) continue;
    let matchCount = 0;
    for (let k = 0; k < props.keys.length; k++) {
      if (ctx.classGenGetFieldInfo(cls.name, props.keys[k])) {
        matchCount++;
      }
    }
    if (matchCount > bestCount) {
      bestCount = matchCount;
      bestMatch = cls.name;
    }
  }
  if (bestMatch && bestCount >= 3) return bestMatch;
  return null;
}
