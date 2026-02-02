export interface PropertyTypeInfo {
  type: string;
  offset: number;
}

export interface TypeInfo {
  kind: 'primitive' | 'object' | 'array' | 'unknown';
  llvmType: string;
  properties?: Map<string, PropertyTypeInfo>;
  propertyKeys?: string[];
}
