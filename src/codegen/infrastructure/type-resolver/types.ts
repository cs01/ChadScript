import { ObjectMetadata } from "../symbol-table.js";

export interface FieldInfo {
  index: number;
  type: string;
  tsType?: string;
}

export interface MapTypeInfo {
  keyType: "string" | "number";
  valueType: string;
  llvmKeyType: string;
  llvmValueType: string;
}

export interface SetTypeInfo {
  valueType: "string" | "number";
  llvmValueType: string;
}

export interface TypeGuardInfo {
  varName: string;
  narrowedMetadata: ObjectMetadata;
}

export interface UnionCommonFields {
  keys: string[];
  types: string[];
  tsTypes: string[];
}

export interface ThisFieldMapInfo {
  fieldName: string;
  keyType: string;
  valueType: string;
}

export interface ThisFieldSetInfo {
  fieldName: string;
  valueType: string;
}

export interface ClassGeneratorLike {
  getFieldInfo(className: string, fieldName: string): FieldInfo | null;
  thisPointer?: string | null;
  currentClassName?: string | null;
}
