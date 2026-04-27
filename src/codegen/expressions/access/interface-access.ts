import type { MemberAccessNode } from "../../../ast/types.js";
import type { MemberAccessGeneratorContext } from "./member.js";
import type { InterfaceFieldInfo } from "../../types/interface-struct-generator.js";
import type { FieldInfo } from "../../infrastructure/type-resolver/types.js";
import {
  isAnyArrayTsType,
  classifyArray,
  arrayKindToLlvm,
} from "../../infrastructure/type-system.js";
import {
  loadFieldValue,
  storeInterfaceMetadata,
  resolveConcreteClassByFields,
} from "./class-field-loading.js";
import { accessObjectProperty } from "./struct-access.js";

interface InterfaceProperty {
  name: string;
  type: string;
}

interface InterfaceInfo {
  properties: InterfaceProperty[];
}

function extractBaseTypeNameForInterface(typeStr: string): string {
  const parts = typeStr.split("|");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (part !== "null" && part !== "undefined") {
      return part;
    }
  }
  return typeStr;
}

function lookupInterfaceFromAST(
  ctx: MemberAccessGeneratorContext,
  name: string,
): InterfaceInfo | null {
  const baseName = extractBaseTypeNameForInterface(name);
  const props = ctx.getInterfaceProperties(baseName);
  if (props && props.keys.length > 0) {
    const properties: InterfaceProperty[] = [];
    for (let i = 0; i < props.keys.length; i++) {
      properties.push({ name: props.keys[i], type: props.tsTypes[i] });
    }
    return { properties };
  }
  const typeAliasProps = ctx.getTypeAliasCommonProperties(baseName);
  if (typeAliasProps && typeAliasProps.keys.length > 0) {
    const properties: InterfaceProperty[] = [];
    for (let i = 0; i < typeAliasProps.keys.length; i++) {
      properties.push({ name: typeAliasProps.keys[i], type: typeAliasProps.tsTypes[i] });
    }
    return { properties };
  }
  return null;
}

function resolveConcreteClassForInterfaceRegister(
  ctx: MemberAccessGeneratorContext,
  register: string,
  interfaceName: string,
): string | null {
  const concrete = ctx.getActualClassType(register);
  if (concrete) return concrete;
  return ctx.findClassImplementingInterface(interfaceName);
}

export function handleChainedInterfaceAccess(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
  params: string[],
): string | null {
  const innerPtr = ctx.generateExpression(expr.object, params);
  const innerType = ctx.getVariableType(innerPtr);

  if (innerType === "i8*") {
    const actualClass = ctx.getActualClassType(innerPtr);
    if (actualClass) {
      const fieldInfo = ctx.classGenGetFieldInfo(actualClass, expr.property);
      if (fieldInfo) {
        const castPtr = ctx.nextTemp();
        ctx.emit(`${castPtr} = bitcast i8* ${innerPtr} to %${actualClass}_struct*`);
        const fieldPtr = ctx.nextTemp();
        ctx.emit(
          `${fieldPtr} = getelementptr inbounds %${actualClass}_struct, %${actualClass}_struct* ${castPtr}, i32 0, i32 ${fieldInfo.index}`,
        );
        const result = loadFieldValue(ctx, fieldPtr, fieldInfo, actualClass, expr.property);
        if (result && !ctx.getActualClassType(result)) {
          const fieldTsType = ctx.classGenGetFieldTsType(actualClass, expr.property);
          if (fieldTsType) {
            const classCount = ctx.getClassesCount();
            for (let ci = 0; ci < classCount; ci++) {
              const cls = ctx.getAstClassAt(ci);
              if (cls && cls.name === fieldTsType) {
                ctx.setActualClassType(result, fieldTsType);
                break;
              }
            }
          }
        }
        return result;
      }
    }
    if (ctx.hasJsonObjectMetadata(innerPtr)) {
      const interfaceType = ctx.getJsonObjectMetadataInterfaceType(innerPtr);
      if (interfaceType && interfaceType.length > 0) {
        if (ctx.interfaceStructGen?.hasInterface(interfaceType)) {
          const ifaceResult = accessObjectPropertyWithNamedInterface(
            ctx,
            innerPtr,
            expr.property,
            interfaceType,
          );
          if (ifaceResult !== null) return ifaceResult;
        }
      }
      const metaKeys = ctx.getJsonObjectMetadataKeys(innerPtr);
      const metaTypes = ctx.getJsonObjectMetadataTypes(innerPtr);
      const metaTsTypes = ctx.getJsonObjectMetadataTsTypes(innerPtr);
      if (metaKeys && metaTypes) {
        const propIndex = metaKeys.indexOf(expr.property);
        if (propIndex !== -1) {
          const resolvedClass = resolveConcreteClassByFields(ctx, metaKeys, expr.property);
          if (resolvedClass) {
            const fieldInfo = ctx.classGenGetFieldInfo(resolvedClass, expr.property);
            if (fieldInfo) {
              const castPtr = ctx.nextTemp();
              ctx.emit(`${castPtr} = bitcast i8* ${innerPtr} to %${resolvedClass}_struct*`);
              const fieldPtr = ctx.nextTemp();
              ctx.emit(
                `${fieldPtr} = getelementptr inbounds %${resolvedClass}_struct, %${resolvedClass}_struct* ${castPtr}, i32 0, i32 ${fieldInfo.index}`,
              );
              ctx.setActualClassType(innerPtr, resolvedClass);
              const result = loadFieldValue(ctx, fieldPtr, fieldInfo, resolvedClass, expr.property);
              return result;
            }
          }
          return accessObjectProperty(
            ctx,
            innerPtr,
            expr.property,
            metaKeys,
            metaTypes,
            metaTsTypes,
          );
        }
      }
    }
    if (expr.property === "type") {
      const structType = "{ i8* }";
      const typedPtr = ctx.nextTemp();
      ctx.emit(`${typedPtr} = bitcast i8* ${innerPtr} to ${structType}*`);
      const fieldPtr = ctx.nextTemp();
      ctx.emit(
        `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 0`,
      );
      const value = ctx.nextTemp();
      ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      ctx.setVariableType(value, "i8*");
      return value;
    }
    return null;
  }

  if (!innerType || !innerType.startsWith("%") || !innerType.endsWith("*")) {
    return null;
  }

  let innerInterfaceName = innerType.substring(1, innerType.length - 1);

  const innerInterfaceDefResult = lookupInterfaceFromAST(ctx, innerInterfaceName);

  let propIndex: number = -1;
  let propType = "";
  let fieldPtr = "";

  if (innerInterfaceDefResult) {
    const innerInterfaceDef = innerInterfaceDefResult as InterfaceInfo;
    const innerProps = innerInterfaceDef.properties;
    if (!innerProps) {
      return null;
    }
    if (innerProps.length === 0) {
      return null;
    }

    for (let i = 0; i < innerProps.length; i++) {
      const p = innerProps[i] as InterfaceProperty;
      if (p.name === expr.property) {
        propIndex = i;
        break;
      }
    }
    if (propIndex === -1) return null;

    const innerPropField = innerProps[propIndex] as InterfaceProperty;
    propType = innerPropField.type;

    const implementingClass = resolveConcreteClassForInterfaceRegister(
      ctx,
      innerPtr,
      innerInterfaceName,
    );
    if (implementingClass) {
      const classFieldInfo = ctx.classGenGetFieldInfo(implementingClass, expr.property);
      if (classFieldInfo) {
        const classFieldInfoTyped = classFieldInfo as FieldInfo;
        const castPtr = ctx.nextTemp();
        ctx.emit(
          `${castPtr} = bitcast %${innerInterfaceName}* ${innerPtr} to %${implementingClass}_struct*`,
        );
        fieldPtr = ctx.nextTemp();
        ctx.emit(
          `${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfoTyped.index}`,
        );
        if (classFieldInfoTyped.tsType) {
          propType = classFieldInfoTyped.tsType;
        }
      } else {
        fieldPtr = ctx.nextTemp();
        ctx.emit(
          `${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${propIndex}`,
        );
      }
    } else {
      const interfaceFieldNames: string[] = [];
      for (let ii = 0; ii < innerProps.length; ii++) {
        const pp = innerProps[ii] as InterfaceProperty;
        interfaceFieldNames.push(pp.name);
      }
      const structuralClass = resolveConcreteClassByFields(ctx, interfaceFieldNames, expr.property);
      if (structuralClass) {
        const classFieldInfo = ctx.classGenGetFieldInfo(structuralClass, expr.property);
        if (classFieldInfo) {
          const classFieldInfoTyped = classFieldInfo as FieldInfo;
          const castPtr = ctx.nextTemp();
          ctx.emit(
            `${castPtr} = bitcast %${innerInterfaceName}* ${innerPtr} to %${structuralClass}_struct*`,
          );
          fieldPtr = ctx.nextTemp();
          ctx.emit(
            `${fieldPtr} = getelementptr inbounds %${structuralClass}_struct, %${structuralClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfoTyped.index}`,
          );
          ctx.setActualClassType(innerPtr, structuralClass);
          if (classFieldInfoTyped.tsType) {
            propType = classFieldInfoTyped.tsType;
          }
        } else {
          fieldPtr = ctx.nextTemp();
          ctx.emit(
            `${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${propIndex}`,
          );
        }
      } else {
        fieldPtr = ctx.nextTemp();
        ctx.emit(
          `${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${propIndex}`,
        );
      }
    }
  } else if (innerInterfaceName.endsWith("_struct")) {
    const className = innerInterfaceName.slice(0, -7);
    const fieldInfo = ctx.classGenGetFieldInfo(className, expr.property);
    if (!fieldInfo) {
      return null;
    }

    if (fieldInfo.tsType) {
      propType = fieldInfo.tsType;
    } else if (fieldInfo.type === "double") {
      propType = "number";
    } else if (fieldInfo.type === "boolean") {
      propType = "boolean";
    } else {
      propType = fieldInfo.type;
    }

    fieldPtr = ctx.nextTemp();
    ctx.emit(
      `${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${fieldInfo.index}`,
    );
  } else {
    return null;
  }

  if (expr.property === "nodePtr" || expr.property === "treePtr") {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
    ctx.setVariableType(value, "i8*");
    return value;
  } else if (propType === "string") {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
    ctx.setVariableType(value, "i8*");
    return value;
  } else if (propType === "number") {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load double, double* ${fieldPtr}`);
    ctx.setVariableType(value, "double");
    return value;
  } else if (propType === "boolean") {
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load double, double* ${fieldPtr}`);
    ctx.setVariableType(value, "double");
    return value;
  } else if (isAnyArrayTsType(propType)) {
    const llvmT = arrayKindToLlvm(classifyArray(propType));
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load ${llvmT}, ${llvmT}* ${fieldPtr}`);
    ctx.setVariableType(value, llvmT);
    return value;
  } else {
    let nestedTypeName = propType;
    if (nestedTypeName.endsWith("?")) {
      nestedTypeName = nestedTypeName.slice(0, nestedTypeName.length - 1);
    }
    if (nestedTypeName.indexOf(" | null") !== -1) {
      nestedTypeName = nestedTypeName.replace(" | null", "");
    }
    if (nestedTypeName.indexOf(" | undefined") !== -1) {
      nestedTypeName = nestedTypeName.replace(" | undefined", "");
    }
    if (nestedTypeName === "string") {
      const value = ctx.nextTemp();
      ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      ctx.setVariableType(value, "i8*");
      return value;
    }
    if (nestedTypeName === "number") {
      const value = ctx.nextTemp();
      ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      ctx.setVariableType(value, "double");
      return value;
    }
    const nestedInterfaceDefResult = lookupInterfaceFromAST(ctx, nestedTypeName);
    if (nestedInterfaceDefResult) {
      const value = ctx.nextTemp();
      ctx.emit(`${value} = load %${nestedTypeName}*, %${nestedTypeName}** ${fieldPtr}`);
      ctx.setVariableType(value, `%${nestedTypeName}*`);
      const concreteClass = ctx.findClassImplementingInterface(nestedTypeName);
      if (concreteClass) {
        ctx.setActualClassType(value, concreteClass);
      }
      return value;
    }
    const classFields = ctx.classGenGetClassFields(nestedTypeName);
    if (classFields && classFields.length > 0) {
      const value = ctx.nextTemp();
      ctx.emit(
        `${value} = load %${nestedTypeName}_struct*, %${nestedTypeName}_struct** ${fieldPtr}`,
      );
      ctx.setVariableType(value, `%${nestedTypeName}_struct*`);
      ctx.setActualClassType(value, nestedTypeName);
      return value;
    }
    let isAstClass = false;
    const classCount = ctx.getClassesCount();
    for (let ci = 0; ci < classCount; ci++) {
      const cls = ctx.getAstClassAt(ci);
      if (cls && cls.name === nestedTypeName) {
        isAstClass = true;
        break;
      }
    }
    if (isAstClass) {
      const value = ctx.nextTemp();
      ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      ctx.setVariableType(value, "i8*");
      ctx.setActualClassType(value, nestedTypeName);
      return value;
    }
    const value = ctx.nextTemp();
    ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
    ctx.setVariableType(value, "i8*");
    if (nestedTypeName) {
      const concreteClass = ctx.findClassImplementingInterface(nestedTypeName);
      if (concreteClass) {
        ctx.setActualClassType(value, concreteClass);
      }
    }
    return value;
  }
}

export function accessInterfacePropertyWithNamedStruct(
  ctx: MemberAccessGeneratorContext,
  varName: string,
  property: string,
  interfaceType: string,
): string {
  const interfaceInfo = ctx.interfaceStructGen?.getInterfaceStruct(interfaceType);
  if (!interfaceInfo) {
    return ctx.emitError(`Interface ${interfaceType} not found in interface struct generator`);
  }

  let propIndex: number = -1;
  let propLlvmType = "";
  let propTsType = "";
  const fields = interfaceInfo.fields as InterfaceFieldInfo[];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as InterfaceFieldInfo;
    if (field.name === property) {
      propIndex = i;
      propLlvmType = field.llvmType;
      propTsType = field.tsType;
      break;
    }
  }

  if (propIndex === -1) {
    const fieldNames: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; tsType: string; llvmType: string };
      fieldNames.push(f.name);
    }
    return ctx.emitError(
      `Property '${property}' not found on interface '${interfaceType}'. Available properties: ${fieldNames.join(", ")}`,
    );
  }

  const structType = `%${interfaceType}`;
  const varPtr = ctx.getVariableAlloca(varName);
  if (!varPtr) {
    return ctx.emitError(`Variable ${varName} not found in symbol table`);
  }

  const objPtrRaw = ctx.nextTemp();
  ctx.emit(`${objPtrRaw} = load i8*, i8** ${varPtr}`);

  const objPtr = ctx.nextTemp();
  ctx.emit(`${objPtr} = bitcast i8* ${objPtrRaw} to ${structType}*`);

  const fieldPtr = ctx.nextTemp();
  ctx.emit(
    `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${propIndex}`,
  );

  const value = ctx.nextTemp();
  ctx.emit(`${value} = load ${propLlvmType}, ${propLlvmType}* ${fieldPtr}`);
  ctx.setVariableType(value, propLlvmType);

  if (
    propTsType &&
    ["string", "number", "boolean"].indexOf(propTsType) === -1 &&
    !isAnyArrayTsType(propTsType)
  ) {
    storeInterfaceMetadata(ctx, value, propTsType);
  }

  return value;
}

export function accessObjectPropertyWithNamedInterface(
  ctx: MemberAccessGeneratorContext,
  objPtr: string,
  property: string,
  interfaceType: string,
): string | null {
  const concreteClass =
    ctx.getActualClassType(objPtr) || ctx.findClassImplementingInterface(interfaceType);
  if (concreteClass) {
    const classFieldInfo = ctx.classGenGetFieldInfo(concreteClass, property);
    if (classFieldInfo) {
      const castPtr = ctx.nextTemp();
      ctx.emit(`${castPtr} = bitcast i8* ${objPtr} to %${concreteClass}_struct*`);
      const fieldPtr = ctx.nextTemp();
      ctx.emit(
        `${fieldPtr} = getelementptr inbounds %${concreteClass}_struct, %${concreteClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfo.index}`,
      );
      const result = loadFieldValue(ctx, fieldPtr, classFieldInfo, concreteClass, property);
      return result;
    }
  }

  const objMeta = ctx.getJsonObjectMetadata(objPtr);
  if (objMeta) {
    const checkInfo = ctx.interfaceStructGen?.getInterfaceStruct(interfaceType);
    if (checkInfo) {
      const checkFields = checkInfo.fields as InterfaceFieldInfo[];
      if (objMeta.keys.length !== checkFields.length) {
        return null;
      }
      for (let li = 0; li < objMeta.keys.length; li++) {
        if (objMeta.keys[li] !== (checkFields[li] as InterfaceFieldInfo).name) {
          return null;
        }
      }
    }
  }

  const interfaceInfo = ctx.interfaceStructGen?.getInterfaceStruct(interfaceType);
  if (!interfaceInfo) {
    return ctx.emitError(`Interface ${interfaceType} not found in interface struct generator`);
  }

  let propIndex: number = -1;
  let propLlvmType = "";
  let propTsType = "";
  const fields = interfaceInfo.fields as InterfaceFieldInfo[];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as InterfaceFieldInfo;
    if (field.name === property) {
      propIndex = i;
      propLlvmType = field.llvmType;
      propTsType = field.tsType;
      break;
    }
  }

  if (propIndex === -1) {
    return null;
  }

  const structType = `%${interfaceType}`;
  const typedPtr = ctx.nextTemp();
  ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

  const fieldPtr = ctx.nextTemp();
  ctx.emit(
    `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`,
  );

  const value = ctx.nextTemp();
  ctx.emit(`${value} = load ${propLlvmType}, ${propLlvmType}* ${fieldPtr}`);
  ctx.setVariableType(value, propLlvmType);

  if (
    propTsType &&
    ["string", "number", "boolean"].indexOf(propTsType) === -1 &&
    !isAnyArrayTsType(propTsType)
  ) {
    storeInterfaceMetadata(ctx, value, propTsType);
  }

  return value;
}
