import * as ts from "typescript";
import {
  FunctionNode,
  ClassNode,
  ClassMethod,
  ClassField,
  ImportDeclaration,
  ExportDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  EnumDeclaration,
  EnumMember,
  BlockStatement,
  FunctionParameter,
} from "../../ast/types.js";
import { transformBlock } from "./statements.js";
import { transformExpression } from "./expressions.js";
import { getLoc } from "../transformer.js";

export function transformFunctionDeclaration(
  node: ts.FunctionDeclaration,
  checker: ts.TypeChecker | undefined,
): FunctionNode | null {
  if (!node.name) return null;

  const name = node.name.text;
  const params = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));

  const paramTypes = node.parameters
    .map((p) => {
      if (p.type) {
        return extractTypeString(p.type);
      }
      return undefined;
    })
    .filter(Boolean) as string[];

  const parameters: FunctionParameter[] = node.parameters.map((p) => {
    const paramName = ts.isIdentifier(p.name) ? p.name.text : "";
    let paramType = p.type ? extractTypeString(p.type) : undefined;
    const optional = !!p.questionToken;
    const isRest = !!p.dotDotDotToken;
    if (isRest && paramType && !paramType.endsWith("[]")) {
      paramType = paramType + "[]";
    }
    let defaultValue = undefined;
    if (p.initializer) {
      defaultValue = transformExpression(p.initializer, checker);
    }
    return { name: paramName, type: paramType, optional, defaultValue };
  });

  let returnType: string | undefined;
  if (node.type) {
    returnType = extractTypeString(node.type);
  }

  let typeParameters: string[] | undefined;
  if (node.typeParameters && node.typeParameters.length > 0) {
    typeParameters = node.typeParameters.map((tp) => tp.name.text);
  }

  const body: BlockStatement = node.body
    ? transformBlock(node.body, checker)
    : { type: "block", statements: [] };

  const isAsync = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false;

  // Must include all FunctionNode interface fields to match struct layout of
  // declare function creation site in transformer.ts (see FunctionNode in types.ts)
  return {
    name,
    params,
    body,
    returnType,
    paramTypes: paramTypes.length > 0 ? paramTypes : undefined,
    typeParameters,
    async: isAsync || undefined,
    parameters: parameters.length > 0 ? parameters : undefined,
    loc: getLoc(node),
    declare: false,
  };
}

export function transformClassDeclaration(
  node: ts.ClassDeclaration,
  checker: ts.TypeChecker | undefined,
): ClassNode | null {
  if (!node.name) return null;

  const name = node.name.text;

  let extendsClause: string | undefined;
  const implementsClause: string[] = [];
  if (node.heritageClauses) {
    for (const clause of node.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.length > 0) {
        const type = clause.types[0];
        if (ts.isIdentifier(type.expression)) {
          extendsClause = type.expression.text;
        }
      } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
        for (const type of clause.types) {
          if (ts.isIdentifier(type.expression)) {
            implementsClause.push(type.expression.text);
          }
        }
      }
    }
  }

  const fields: ClassField[] = [];
  const methods: ClassMethod[] = [];

  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member)) {
      const field = transformPropertyDeclaration(member, checker);
      if (field) {
        fields.push(field);
      }
    } else if (ts.isMethodDeclaration(member)) {
      const method = transformMethodDeclaration(member, checker, false);
      if (method) {
        methods.push(method);
      }
    } else if (ts.isConstructorDeclaration(member)) {
      const result = transformConstructorDeclaration(member, checker);
      if (result) {
        methods.push(result.method);
        fields.push(...result.parameterProperties);
      }
    } else if (ts.isGetAccessorDeclaration(member)) {
      const method = transformAccessorDeclaration(member, checker, "get");
      if (method) {
        methods.push(method);
      }
    } else if (ts.isSetAccessorDeclaration(member)) {
      const method = transformAccessorDeclaration(member, checker, "set");
      if (method) {
        methods.push(method);
      }
    }
  }

  return {
    name,
    extends: extendsClause,
    implements: implementsClause,
    fields,
    methods,
    loc: getLoc(node),
  };
}

function transformPropertyDeclaration(
  node: ts.PropertyDeclaration,
  checker: ts.TypeChecker | undefined,
): ClassField | null {
  if (!ts.isIdentifier(node.name)) return null;

  const name = node.name.text;
  let fieldType: ClassField["fieldType"] = "double";
  let tsType: string | undefined;

  if (node.type) {
    const typeStr = extractTypeString(node.type);
    if (typeStr === "string") fieldType = "string";
    else if (typeStr === "number") fieldType = "double";
    else if (typeStr === "boolean") fieldType = "boolean";
    else if (typeStr === "string[]") fieldType = "string[]";
    else if (typeStr === "number[]") fieldType = "number[]";
    else if (typeStr === "boolean[]") fieldType = "boolean[]";
    else {
      tsType = typeStr;
    }
  } else if (node.initializer && ts.isNewExpression(node.initializer)) {
    const newExpr = node.initializer;
    if (newExpr.expression && ts.isIdentifier(newExpr.expression)) {
      const className = newExpr.expression.text;
      if (newExpr.typeArguments && newExpr.typeArguments.length > 0) {
        const args = newExpr.typeArguments.map(extractTypeString).join(", ");
        tsType = `${className}<${args}>`;
      } else {
        tsType = className;
      }
    }
  }

  const isStatic = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
  const result: ClassField = { name, fieldType, tsType };
  if (node.initializer) {
    result.initializer = transformExpression(node.initializer, checker);
  }
  if (isStatic) {
    result.isStatic = true;
  }
  return result;
}

function transformMethodDeclaration(
  node: ts.MethodDeclaration,
  checker: ts.TypeChecker | undefined,
  isConstructor: boolean,
): ClassMethod | null {
  if (!ts.isIdentifier(node.name)) return null;

  const name = node.name.text;
  const params = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));

  const paramTypes = node.parameters.map((p) => {
    if (p.type) {
      return extractTypeString(p.type);
    }
    return "any";
  });

  let returnType: string | undefined;
  if (node.type) {
    returnType = extractTypeString(node.type);
  }

  const body: BlockStatement = node.body
    ? transformBlock(node.body, checker)
    : { type: "block", statements: [] };

  const isStatic = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
  const result: ClassMethod = {
    type: "method",
    name,
    params,
    paramTypes,
    parameterProperties: undefined,
    returnType,
    body,
    isConstructor,
  };
  if (isStatic) {
    result.isStatic = true;
  }
  return result;
}

function transformConstructorDeclaration(
  node: ts.ConstructorDeclaration,
  checker: ts.TypeChecker | undefined,
): { method: ClassMethod; parameterProperties: ClassField[] } | null {
  const params = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));

  const paramTypes = node.parameters.map((p) => {
    if (p.type) {
      return extractTypeString(p.type);
    }
    return "any";
  });

  const parameterProperties: ClassField[] = [];
  for (const param of node.parameters) {
    const hasAccessModifier = param.modifiers?.some(
      (m) =>
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.PublicKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword ||
        m.kind === ts.SyntaxKind.ReadonlyKeyword,
    );
    if (hasAccessModifier && ts.isIdentifier(param.name)) {
      const name = param.name.text;
      let fieldType: ClassField["fieldType"] = "double";
      let tsType: string | undefined;
      if (param.type) {
        const typeStr = extractTypeString(param.type);
        if (typeStr === "string") fieldType = "string";
        else if (typeStr === "number") fieldType = "double";
        else if (typeStr === "boolean") fieldType = "boolean";
        else if (typeStr === "string[]") fieldType = "string[]";
        else if (typeStr === "number[]") fieldType = "number[]";
        else if (typeStr === "boolean[]") fieldType = "boolean[]";
        else {
          tsType = typeStr;
        }
      }
      parameterProperties.push({ name, fieldType, tsType });
    }
  }

  const body: BlockStatement = node.body
    ? transformBlock(node.body, checker)
    : { type: "block", statements: [] };

  return {
    method: {
      type: "method",
      name: "constructor",
      params,
      paramTypes,
      parameterProperties:
        parameterProperties.length > 0 ? parameterProperties.map((p) => p.name) : undefined,
      returnType: undefined,
      body,
      isConstructor: true,
    },
    parameterProperties,
  };
}

function transformAccessorDeclaration(
  node: ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
  checker: ts.TypeChecker | undefined,
  kind: "get" | "set",
): ClassMethod | null {
  if (!ts.isIdentifier(node.name)) return null;

  const name = `${kind}_${node.name.text}`;
  const params = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));

  const body: BlockStatement = node.body
    ? transformBlock(node.body, checker)
    : { type: "block", statements: [] };

  return {
    type: "method",
    name,
    params,
    paramTypes: undefined,
    parameterProperties: undefined,
    returnType: undefined,
    body,
    isConstructor: false,
  };
}

export function transformInterfaceDeclaration(
  node: ts.InterfaceDeclaration,
): InterfaceDeclaration | null {
  const name = node.name.text;
  const fields: { name: string; type: string }[] = [];
  const methods: { name: string; params: string[]; paramTypes: string[]; returnType: string }[] =
    [];
  const extendsClause: string[] = [];

  if (node.heritageClauses) {
    for (const clause of node.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
        for (const type of clause.types) {
          if (ts.isIdentifier(type.expression)) {
            extendsClause.push(type.expression.text);
          }
        }
      }
    }
  }

  for (const member of node.members) {
    if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
      const fieldName = member.name.text;
      const fieldType = member.type ? extractTypeString(member.type) : "any";
      fields.push({ name: fieldName, type: fieldType });
    } else if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) {
      const methodName = member.name.text;
      const params = member.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));
      const paramTypes = member.parameters.map((p) => (p.type ? extractTypeString(p.type) : "any"));
      const returnType = member.type ? extractTypeString(member.type) : "void";
      methods.push({ name: methodName, params, paramTypes, returnType });
    }
  }

  return {
    name,
    extends: extendsClause,
    fields,
    methods,
  };
}

export function transformTypeAliasDeclaration(
  node: ts.TypeAliasDeclaration,
): TypeAliasDeclaration | null {
  const name = node.name.text;
  const unionMembers: string[] = [];

  if (ts.isUnionTypeNode(node.type)) {
    for (const typeNode of node.type.types) {
      if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
        unionMembers.push(typeNode.typeName.text);
      } else if (ts.isLiteralTypeNode(typeNode)) {
        if (ts.isStringLiteral(typeNode.literal)) {
          unionMembers.push(`"${typeNode.literal.text}"`);
        } else if (ts.isNumericLiteral(typeNode.literal)) {
          unionMembers.push(typeNode.literal.text);
        }
      } else {
        unionMembers.push(extractTypeString(typeNode));
      }
    }
  } else if (ts.isTypeReferenceNode(node.type)) {
    unionMembers.push(extractTypeString(node.type));
  }

  return { name, unionMembers };
}

export function transformEnumDeclaration(node: ts.EnumDeclaration): EnumDeclaration | null {
  const name = node.name.text;
  const members: EnumMember[] = [];
  let isString = false;

  let currentValue = 0;
  for (const member of node.members) {
    if (ts.isIdentifier(member.name)) {
      const memberName = member.name.text;
      let value: number = currentValue;
      let stringValue: string | undefined;

      if (member.initializer) {
        if (ts.isNumericLiteral(member.initializer)) {
          value = parseInt(member.initializer.text, 10);
          currentValue = value + 1;
        } else if (ts.isStringLiteral(member.initializer)) {
          stringValue = member.initializer.text;
          isString = true;
          value = currentValue;
          currentValue = currentValue + 1;
        }
      } else {
        currentValue = currentValue + 1;
      }

      members.push({ name: memberName, value, stringValue });
    }
  }

  return { name, members, isString: isString || undefined };
}

export function transformImportDeclaration(node: ts.ImportDeclaration): ImportDeclaration | null {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return null;

  if (node.importClause && node.importClause.isTypeOnly) {
    return null;
  }

  const source = node.moduleSpecifier.text;
  const specifiers: string[] = [];
  const aliasedSpecifiers: { name: string; original?: string }[] = [];

  let defaultImport: string | undefined;

  if (node.importClause) {
    if (node.importClause.name) {
      // import Foo from './bar' — default import
      defaultImport = node.importClause.name.text;
      specifiers.push(node.importClause.name.text);
      aliasedSpecifiers.push({ name: node.importClause.name.text, original: undefined });
    }

    if (node.importClause.namedBindings) {
      if (ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          const localName = element.name.text;
          specifiers.push(localName);
          if (element.propertyName) {
            aliasedSpecifiers.push({ name: localName, original: element.propertyName.text });
          } else {
            aliasedSpecifiers.push({ name: localName, original: undefined });
          }
        }
      } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
        specifiers.push(`* as ${node.importClause.namedBindings.name.text}`);
        aliasedSpecifiers.push({
          name: `* as ${node.importClause.namedBindings.name.text}`,
          original: undefined,
        });
      }
    }
  }

  return { type: "import", specifiers, aliasedSpecifiers, source, defaultImport };
}

export function transformExportDeclaration(
  _node: ts.ExportDeclaration,
  _ast: any,
  _checker: ts.TypeChecker | undefined,
): ExportDeclaration | null {
  return null;
}

function extractTypeString(typeNode: ts.TypeNode): string {
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = ts.isIdentifier(typeNode.typeName)
      ? typeNode.typeName.text
      : typeNode.typeName.getText();

    if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      const args = typeNode.typeArguments.map(extractTypeString).join(", ");
      return `${typeName}<${args}>`;
    }
    return typeName;
  } else if (ts.isArrayTypeNode(typeNode)) {
    const elem = extractTypeString(typeNode.elementType);
    return `${elem}[]`;
  } else if (typeNode.kind === ts.SyntaxKind.StringKeyword) {
    return "string";
  } else if (typeNode.kind === ts.SyntaxKind.NumberKeyword) {
    return "number";
  } else if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) {
    return "boolean";
  } else if (typeNode.kind === ts.SyntaxKind.VoidKeyword) {
    return "void";
  } else if (typeNode.kind === ts.SyntaxKind.AnyKeyword) {
    return "any";
  } else if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.map(extractTypeString).join(" | ");
  } else if (ts.isFunctionTypeNode(typeNode)) {
    const params = typeNode.parameters
      .map((p) => {
        const pName = ts.isIdentifier(p.name) ? p.name.text : "";
        const pType = p.type ? extractTypeString(p.type) : "any";
        return `${pName}: ${pType}`;
      })
      .join(", ");
    const ret = typeNode.type ? extractTypeString(typeNode.type) : "void";
    return `(${params}) => ${ret}`;
  } else if (ts.isTypeLiteralNode(typeNode)) {
    const members: string[] = [];
    for (const member of typeNode.members) {
      if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
        const propName = member.name.text;
        const propType = member.type ? extractTypeString(member.type) : "any";
        members.push(`${propName}: ${propType}`);
      }
    }
    if (members.length > 0) {
      return `{ ${members.join("; ")} }`;
    }
    return "object";
  }
  return typeNode.getText();
}
