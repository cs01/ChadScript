import * as ts from 'typescript';
import * as path from 'path';

export type { TypeInfo, PropertyTypeInfo } from '../codegen/infrastructure/types.js';
import type { TypeInfo } from '../codegen/infrastructure/types.js';

/**
 * TypeScript Type Checker Wrapper
 *
 * Provides type information for ChadScript compilation.
 * Uses TypeScript's compiler API to resolve types at compile time.
 */

export class TypeChecker {
  private program: ts.Program;
  private checker: ts.TypeChecker;
  private sourceFiles: Map<string, ts.SourceFile>;

  constructor(files: { filename: string; code: string }[]) {
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2015,
      module: ts.ModuleKind.ES2015,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      strict: true,
      noEmit: true,
      allowJs: true,
    };

    this.sourceFiles = new Map();
    const filenames: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const sf = ts.createSourceFile(
        file.filename,
        file.code,
        ts.ScriptTarget.ES2015,
        true
      );
      this.sourceFiles.set(file.filename, sf);
      const jsName = file.filename.replace(/\.ts$/, '.js');
      if (jsName !== file.filename) {
        this.sourceFiles.set(jsName, sf);
      }
      filenames.push(file.filename);
    }

    const self = this;
    const host: ts.CompilerHost = {
      getSourceFile: (fileName) => self.lookupSourceFile(fileName),
      writeFile: () => {},
      getCurrentDirectory: () => process.cwd(),
      getDirectories: () => [],
      fileExists: (fileName) => self.lookupSourceFile(fileName) !== undefined,
      readFile: () => '',
      getCanonicalFileName: (fileName) => fileName,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      getDefaultLibFileName: () => 'lib.d.ts',
    };

    this.program = ts.createProgram(filenames, compilerOptions, host);
    this.checker = this.program.getTypeChecker();
  }

  private lookupSourceFile(fileName: string): ts.SourceFile | undefined {
    if (this.sourceFiles.has(fileName)) {
      return this.sourceFiles.get(fileName);
    }
    const tsName = fileName.replace(/\.js$/, '.ts');
    if (tsName !== fileName && this.sourceFiles.has(tsName)) {
      return this.sourceFiles.get(tsName);
    }
    for (const [key, sf] of this.sourceFiles.entries()) {
      if (key.endsWith(fileName) || key.endsWith(fileName.replace(/\.js$/, '.ts'))) {
        return sf;
      }
      const keyBase = path.basename(key);
      const fileBase = path.basename(fileName);
      if (keyBase === fileBase || keyBase === fileBase.replace(/\.js$/, '.ts')) {
        return sf;
      }
    }
    return undefined;
  }

  private findFunctionInAllFiles(functionName: string): ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration | undefined {
    for (const sourceFile of this.sourceFiles.values()) {
      const result = this.findFunctionInNode(sourceFile, functionName);
      if (result) {
        return result;
      }
    }
    return undefined;
  }

  private findFunctionInNode(node: ts.Node, functionName: string): ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration | undefined {
    let found: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration | undefined;

    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      return node;
    }

    if (ts.isClassDeclaration(node)) {
      for (const member of node.members) {
        if (ts.isConstructorDeclaration(member) && functionName === 'constructor') {
          return member;
        }
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === functionName) {
          return member;
        }
      }
    }

    ts.forEachChild(node, (child) => {
      if (!found) {
        found = this.findFunctionInNode(child, functionName);
      }
    });

    return found;
  }

  /**
   * Get type information for a property access expression
   *
   * @param objectName - Name of the object variable (e.g., 'req')
   * @param propertyName - Name of the property (e.g., 'method')
   * @param functionName - Name of the function containing this access
   * @returns Type information if available
   */
  getPropertyType(objectName: string, propertyName: string, functionName: string): TypeInfo | null {
    try {
      const targetFunction = this.findFunctionInAllFiles(functionName);

      if (!targetFunction) {
        return null;
      }

      const param = targetFunction.parameters.find(p =>
        ts.isIdentifier(p.name) && p.name.text === objectName
      );

      if (!param || !param.type) {
        return null;
      }

      const type = this.checker.getTypeFromTypeNode(param.type);

      const prop = type.getProperty(propertyName);
      if (!prop) {
        return null;
      }

      const propType = this.checker.getTypeOfSymbolAtLocation(prop, param);
      const llvmType = this.typeToLLVM(propType);
      const objProps = this.getObjectProperties(type);

      return {
        kind: 'primitive',
        llvmType,
        properties: objProps.map,
        propertyKeys: objProps.keys,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all properties of an object type
   */
  private getObjectProperties(type: ts.Type): { map: Map<string, { type: string; offset: number }>; keys: string[] } {
    const props = new Map<string, { type: string; offset: number }>();
    const keys: string[] = [];
    const properties = type.getProperties();

    properties.forEach((prop, index) => {
      const propType = this.checker.getTypeOfSymbolAtLocation(
        prop,
        prop.valueDeclaration!
      );
      props.set(prop.name, {
        type: this.typeToLLVM(propType),
        offset: index,
      });
      keys.push(prop.name);
    });

    return { map: props, keys };
  }

  /**
   * Convert TypeScript type to LLVM type
   */
  private typeToLLVM(type: ts.Type): string {
    // Check for string type
    if (type.flags & ts.TypeFlags.String || type.flags & ts.TypeFlags.StringLiteral) {
      return 'i8*';
    }

    // Check for number type
    if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) {
      return 'double';
    }

    // Check for boolean type
    if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) {
      return 'i32';
    }

    // Check for object type
    if (type.flags & ts.TypeFlags.Object) {
      const objectType = type as ts.ObjectType;

      // Check if it's an array
      if (this.checker.isArrayType(objectType)) {
        return '%Array*';
      }

      // Generic object
      return 'i8*';
    }

    // Default to double
    return 'double';
  }

  /**
   * Get full object structure for a parameter
   */
  getParameterType(paramName: string, functionName: string): TypeInfo | null {
    try {
      const targetFunction = this.findFunctionInAllFiles(functionName);

      if (!targetFunction) {
        return null;
      }

      const param = targetFunction.parameters.find(p =>
        ts.isIdentifier(p.name) && p.name.text === paramName
      );

      if (!param || !param.type) {
        return null;
      }

      const type = this.checker.getTypeFromTypeNode(param.type);
      const objProps = this.getObjectProperties(type);

      return {
        kind: 'object',
        llvmType: 'i8*',
        properties: objProps.map,
        propertyKeys: objProps.keys,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get function signature (parameter and return types)
   */
  getFunctionType(functionName: string): { parameters: { name: string; type: string }[]; returnType: string } | null {
    try {
      const targetFunction = this.findFunctionInAllFiles(functionName);

      if (!targetFunction) {
        return null;
      }

      const parameters: { name: string; type: string }[] = [];
      for (const param of targetFunction.parameters) {
        if (!ts.isIdentifier(param.name)) {
          continue;
        }

        let paramType = 'number';
        if (param.type) {
          if (ts.isArrayTypeNode(param.type)) {
            const elementTypeNode = param.type.elementType;
            if (elementTypeNode.kind === ts.SyntaxKind.StringKeyword) {
              paramType = 'string[]';
            } else if (elementTypeNode.kind === ts.SyntaxKind.NumberKeyword) {
              paramType = 'number[]';
            } else if (elementTypeNode.kind === ts.SyntaxKind.BooleanKeyword) {
              paramType = 'boolean[]';
            } else {
              paramType = 'object[]';
            }
          } else {
            const type = this.checker.getTypeFromTypeNode(param.type);
            if (type.flags & ts.TypeFlags.String || type.flags & ts.TypeFlags.StringLiteral) {
              paramType = 'string';
            } else if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) {
              paramType = 'number';
            } else if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) {
              paramType = 'boolean';
            } else if (type.flags & ts.TypeFlags.Object) {
              paramType = this.checker.typeToString(type);
            }
          }
        }

        parameters.push({
          name: param.name.text,
          type: paramType,
        });
      }

      let returnType = 'void';
      const funcType = targetFunction as ts.FunctionDeclaration | ts.MethodDeclaration;
      if (funcType.type) {
        const type = this.checker.getTypeFromTypeNode(funcType.type);
        if (type.flags & ts.TypeFlags.String || type.flags & ts.TypeFlags.StringLiteral) {
          returnType = 'string';
        } else if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) {
          returnType = 'number';
        } else if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) {
          returnType = 'boolean';
        } else if (type.flags & ts.TypeFlags.Void) {
          returnType = 'void';
        } else if (type.flags & ts.TypeFlags.Object) {
          returnType = this.checker.typeToString(type);
        }
      }

      return { parameters, returnType };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get interface definition by name
   * Returns property names and their types for code generation
   */
  getInterfaceDefinition(interfaceName: string): { properties: { name: string; type: string }[] } | null {
    try {
      let targetInterface: ts.InterfaceDeclaration | undefined;

      for (const sourceFile of this.sourceFiles.values()) {
        ts.forEachChild(sourceFile, (node) => {
          if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
            targetInterface = node;
          }
        });
        if (targetInterface) {
          break;
        }
      }

      if (!targetInterface) {
        return null;
      }

      const properties: { name: string; type: string }[] = [];
      for (const member of targetInterface.members) {
        if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
          const propName = member.name.text;
          let propType = 'any';
          const isOptional = member.questionToken !== undefined;

          if (member.type) {
            if (ts.isArrayTypeNode(member.type)) {
              const elementTypeNode = member.type.elementType;
              const elemText = elementTypeNode.getText();
              propType = elemText + '[]';
            } else {
              const type = this.checker.getTypeFromTypeNode(member.type);
              propType = this.resolvePropertyType(type, isOptional);
            }
          }

          properties.push({ name: propName, type: propType });
        }
      }

      return { properties };
    } catch (error) {
      return null;
    }
  }

  private resolvePropertyType(type: ts.Type, isOptional: boolean): string {
    if (type.flags & ts.TypeFlags.String || type.flags & ts.TypeFlags.StringLiteral) {
      return 'string';
    }
    if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) {
      return 'number';
    }
    if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) {
      return 'boolean';
    }

    if (type.flags & ts.TypeFlags.Union) {
      const unionType = type as ts.UnionType;
      const nonNullTypes = unionType.types.filter(t =>
        !(t.flags & ts.TypeFlags.Undefined) && !(t.flags & ts.TypeFlags.Null)
      );
      if (nonNullTypes.length === 1) {
        const innerType = this.resolvePropertyType(nonNullTypes[0], false);
        return isOptional ? innerType + '?' : innerType;
      }
    }

    try {
      if (this.checker.isArrayType(type as ts.ObjectType)) {
        const typeArgs = this.checker.getTypeArguments(type as ts.TypeReference);
        if (typeArgs && typeArgs.length > 0) {
          const elementType = this.resolvePropertyType(typeArgs[0], false);
          return elementType + '[]';
        }
        return 'any[]';
      }
    } catch {
    }

    if (type.flags & ts.TypeFlags.Object) {
      const typeName = this.checker.typeToString(type);
      if (typeName && typeName !== 'object' && !typeName.includes('{')) {
        if (typeName.endsWith('[]')) {
          return typeName;
        }
        return isOptional ? typeName + '?' : typeName;
      }
    }

    return 'any';
  }

  getArrayElementInterface(objectName: string, propertyName: string, functionName: string): { interfaceName: string; properties: { name: string; type: string }[] } | null {
    try {
      const targetFunction = this.findFunctionInAllFiles(functionName);
      if (!targetFunction) {
        return null;
      }

      const param = targetFunction.parameters.find(p =>
        ts.isIdentifier(p.name) && p.name.text === objectName
      );

      if (!param || !param.type) {
        return null;
      }

      const objectType = this.checker.getTypeFromTypeNode(param.type);
      const prop = objectType.getProperty(propertyName);
      if (!prop) {
        return null;
      }

      const propType = this.checker.getTypeOfSymbolAtLocation(prop, param);
      if (!this.checker.isArrayType(propType as ts.ObjectType)) {
        return null;
      }

      const typeArgs = this.checker.getTypeArguments(propType as ts.TypeReference);
      if (!typeArgs || typeArgs.length === 0) {
        return null;
      }

      const elementType = typeArgs[0];
      const interfaceName = this.checker.typeToString(elementType);

      const interfaceDef = this.getInterfaceDefinition(interfaceName);
      if (interfaceDef) {
        return {
          interfaceName,
          properties: interfaceDef.properties
        };
      }

      if (elementType.flags & ts.TypeFlags.Object) {
        const objType = elementType as ts.ObjectType;
        const props = objType.getProperties();
        if (props.length > 0) {
          const properties: { name: string; type: string }[] = [];
          for (const p of props) {
            const pType = this.checker.getTypeOfSymbolAtLocation(p, param);
            let propType = 'any';
            if (pType.flags & ts.TypeFlags.String || pType.flags & ts.TypeFlags.StringLiteral) {
              propType = 'string';
            } else if (pType.flags & ts.TypeFlags.Number || pType.flags & ts.TypeFlags.NumberLiteral) {
              propType = 'number';
            } else if (pType.flags & ts.TypeFlags.Boolean || pType.flags & ts.TypeFlags.BooleanLiteral) {
              propType = 'boolean';
            }
            properties.push({ name: p.name, type: propType });
          }
          return { interfaceName: '__anonymous', properties };
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  getVariableArrayElementInterface(varName: string, functionName: string): { interfaceName: string; properties: { name: string; type: string }[] } | null {
    try {
      const targetFunction = this.findFunctionInAllFiles(functionName);
      if (!targetFunction) {
        return null;
      }

      let varDecl: ts.VariableDeclaration | undefined;
      const visitNode = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === varName) {
          varDecl = node;
        }
        if (!varDecl) {
          ts.forEachChild(node, visitNode);
        }
      };
      visitNode(targetFunction);

      if (!varDecl || !varDecl.type) {
        return null;
      }

      const varType = this.checker.getTypeFromTypeNode(varDecl.type);
      if (!this.checker.isArrayType(varType as ts.ObjectType)) {
        return null;
      }

      const typeArgs = this.checker.getTypeArguments(varType as ts.TypeReference);
      if (!typeArgs || typeArgs.length === 0) {
        return null;
      }

      const elementType = typeArgs[0];
      const interfaceName = this.checker.typeToString(elementType);

      const interfaceDef = this.getInterfaceDefinition(interfaceName);
      if (interfaceDef) {
        return {
          interfaceName,
          properties: interfaceDef.properties
        };
      }

      if (elementType.flags & ts.TypeFlags.Object) {
        const objType = elementType as ts.ObjectType;
        const props = objType.getProperties();
        if (props.length > 0) {
          const properties: { name: string; type: string }[] = [];
          for (const p of props) {
            const pType = this.checker.getTypeOfSymbolAtLocation(p, varDecl);
            let propType = 'any';
            if (pType.flags & ts.TypeFlags.String || pType.flags & ts.TypeFlags.StringLiteral) {
              propType = 'string';
            } else if (pType.flags & ts.TypeFlags.Number || pType.flags & ts.TypeFlags.NumberLiteral) {
              propType = 'number';
            } else if (pType.flags & ts.TypeFlags.Boolean || pType.flags & ts.TypeFlags.BooleanLiteral) {
              propType = 'boolean';
            }
            properties.push({ name: p.name, type: propType });
          }
          return { interfaceName: '__anonymous', properties };
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }
}
