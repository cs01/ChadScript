import type { HIRFunction, HIRType, HIRClass } from "./types.js";
import {
  genericFunctionTemplates,
  genericClassTemplates,
  genericSpecializations,
  typeParamContext,
  setTypeParamContext,
  mangleGenericName,
  resolveTypeAnnotation,
} from "./lower-state.js";
import { registerClass, registerFunction, lowerClassDecl } from "./lower-class.js";
import { lowerFunctionDecl } from "./lower-func.js";

export function isGenericFunction(decl: any): boolean {
  return (
    decl.typeParameters?.type === "TsTypeParameterDeclaration" &&
    decl.typeParameters.parameters.length > 0
  );
}

export function isGenericClass(decl: any): boolean {
  return (
    decl.typeParams?.type === "TsTypeParameterDeclaration" && decl.typeParams.parameters.length > 0
  );
}

export function storeGenericFunctionTemplate(decl: any): void {
  const name = decl.identifier.value;
  const typeParams = decl.typeParameters.parameters.map((p: any) => p.name.value);
  genericFunctionTemplates.set(name, { decl, typeParams });
}

export function storeGenericClassTemplate(decl: any): void {
  const name = decl.identifier.value;
  const typeParams = decl.typeParams.parameters.map((p: any) => p.name.value);
  genericClassTemplates.set(name, { decl, typeParams });
}

export function resolveTypeArgs(typeArguments: any): HIRType[] {
  if (!typeArguments?.params) return [];
  return typeArguments.params.map((p: any) => resolveTypeAnnotation(p));
}

export function specializeFunction(baseName: string, typeArgs: HIRType[]): HIRFunction | null {
  const template = genericFunctionTemplates.get(baseName);
  if (!template) return null;

  const mangledName = mangleGenericName(baseName, typeArgs);
  if (genericSpecializations.has(mangledName)) return null;
  genericSpecializations.set(mangledName, true);

  const ctx = new Map<string, HIRType>();
  for (let i = 0; i < template.typeParams.length; i++) {
    ctx.set(template.typeParams[i], typeArgs[i]);
  }

  const savedCtx = typeParamContext;
  setTypeParamContext(ctx);

  const clonedDecl = cloneDeclWithName(template.decl, mangledName);
  registerFunction(clonedDecl);
  const fn = lowerFunctionDecl(clonedDecl);

  setTypeParamContext(savedCtx);

  return fn;
}

export function specializeClass(
  baseName: string,
  typeArgs: HIRType[],
): { hirClass: HIRClass; fns: HIRFunction[] } | null {
  const template = genericClassTemplates.get(baseName);
  if (!template) return null;

  const mangledName = mangleGenericName(baseName, typeArgs);
  if (genericSpecializations.has(mangledName)) return null;
  genericSpecializations.set(mangledName, true);

  const ctx = new Map<string, HIRType>();
  for (let i = 0; i < template.typeParams.length; i++) {
    ctx.set(template.typeParams[i], typeArgs[i]);
  }

  const savedCtx = typeParamContext;
  setTypeParamContext(ctx);

  const clonedDecl = cloneClassDeclWithName(template.decl, mangledName);
  registerClass(clonedDecl);
  const result = lowerClassDecl(clonedDecl);

  setTypeParamContext(savedCtx);

  return result;
}

function cloneDeclWithName(decl: any, newName: string): any {
  const cloned = JSON.parse(JSON.stringify(decl));
  cloned.identifier = { ...cloned.identifier, value: newName };
  delete cloned.typeParameters;
  return cloned;
}

function cloneClassDeclWithName(decl: any, newName: string): any {
  const cloned = JSON.parse(JSON.stringify(decl));
  cloned.identifier = { ...cloned.identifier, value: newName };
  delete cloned.typeParams;
  return cloned;
}
