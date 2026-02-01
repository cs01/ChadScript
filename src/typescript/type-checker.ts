import * as ts from 'typescript';

/**
 * TypeScript Type Checker Wrapper
 *
 * Provides type information for ChadScript compilation.
 * Uses TypeScript's compiler API to resolve types at compile time.
 */

export interface TypeInfo {
  kind: 'primitive' | 'object' | 'array' | 'unknown';
  llvmType: string;
  properties?: Map<string, { type: string; offset: number }>;
}

export class TypeChecker {
  private program: ts.Program;
  private checker: ts.TypeChecker;
  private sourceFiles: Map<string, ts.SourceFile>;

  constructor(files: { filename: string; code: string }[]) {
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2015,
      module: ts.ModuleKind.ES2015,
      strict: true,
      noEmit: true,
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
      filenames.push(file.filename);
    }

    const self = this;
    const host: ts.CompilerHost = {
      getSourceFile: (fileName) => self.sourceFiles.get(fileName),
      writeFile: () => {},
      getCurrentDirectory: () => '',
      getDirectories: () => [],
      fileExists: (fileName) => self.sourceFiles.has(fileName),
      readFile: () => '',
      getCanonicalFileName: (fileName) => fileName,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      getDefaultLibFileName: () => 'lib.d.ts',
    };

    this.program = ts.createProgram(filenames, compilerOptions, host);
    this.checker = this.program.getTypeChecker();
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

      return {
        kind: 'primitive',
        llvmType,
        properties: this.getObjectProperties(type),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all properties of an object type
   */
  private getObjectProperties(type: ts.Type): Map<string, { type: string; offset: number }> {
    const props = new Map<string, { type: string; offset: number }>();
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
    });

    return props;
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

      return {
        kind: 'object',
        llvmType: 'i8*',
        properties: this.getObjectProperties(type),
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

          if (member.type) {
            const type = this.checker.getTypeFromTypeNode(member.type);
            if (type.flags & ts.TypeFlags.String || type.flags & ts.TypeFlags.StringLiteral) {
              propType = 'string';
            } else if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) {
              propType = 'number';
            } else if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) {
              propType = 'boolean';
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
}
