import { AST, Expression, FunctionNode, BlockStatement, MethodCallNode, NewNode, ThisNode } from '../ast/types.js';
import { BaseGenerator } from './generators/base-generator.js';
import { ArrayGenerator } from './generators/array-generator.js';
import { StringGenerator } from './generators/string-generator.js';
import { ObjectGenerator } from './generators/object-generator.js';
import { MapGenerator } from './generators/map-generator.js';
import { SetGenerator } from './generators/set-generator.js';
import { ControlFlowGenerator } from './generators/control-flow-generator.js';
import { ClassGenerator } from './generators/class-generator.js';

// ============================================
// LLVM IR CODE GENERATOR - Main Orchestrator
// ============================================

export class LLVMGenerator extends BaseGenerator {
  private ast: AST;
  private externalFunctions: Set<string> = new Set();

  // Specialized generators
  private arrayGen: ArrayGenerator;
  private stringGen: StringGenerator;
  private objectGen: ObjectGenerator;
  private mapGen: MapGenerator;
  private setGen: SetGenerator;
  private controlFlowGen: ControlFlowGenerator;
  private classGen: ClassGenerator;

  constructor(ast: AST) {
    super();
    this.ast = ast;

    // Initialize specialized generators
    this.arrayGen = new ArrayGenerator();
    this.stringGen = new StringGenerator();
    this.objectGen = new ObjectGenerator();
    this.mapGen = new MapGenerator();
    this.setGen = new SetGenerator();
    this.controlFlowGen = new ControlFlowGenerator();
    this.classGen = new ClassGenerator();

    // Wire up delegates so sub-generators can call back
    this.arrayGen.generateExpression = this.generateExpression.bind(this);
    this.stringGen.generateExpression = this.generateExpression.bind(this);
    this.objectGen.generateExpression = this.generateExpression.bind(this);
    this.mapGen.generateExpression = this.generateExpression.bind(this);
    this.setGen.generateExpression = this.generateExpression.bind(this);
    this.controlFlowGen.generateExpression = this.generateExpression.bind(this);
    this.controlFlowGen.generateBlock = this.generateBlock.bind(this);
    this.classGen.generateExpression = this.generateExpression.bind(this);
    this.classGen.generateBlock = this.generateBlock.bind(this);

    // Override counter methods to use parent's counters
    for (const gen of [this.arrayGen, this.stringGen, this.objectGen, this.mapGen, this.setGen, this.controlFlowGen, this.classGen]) {
      gen.nextTemp = this.nextTemp.bind(this);
      gen.nextLabel = this.nextLabel.bind(this);
      gen.nextString = this.nextString.bind(this);
      // Also provide a way to reset tempCounter
      (gen as any).resetTempCounter = () => { this.tempCounter = 0; };
    }

    // Collect all imported function names
    for (const imp of ast.imports) {
      for (const spec of imp.specifiers) {
        this.externalFunctions.add(spec);
      }
    }
  }

  generate(): string {
    let ir = '';

    // Define array struct type: { i32* data, i32 length, i32 capacity }
    ir += '%Array = type { i32*, i32, i32 }\n';

    // Define Map struct type: { i32* keys, i32* values, i32 size, i32 capacity }
    ir += '%Map = type { i32*, i32*, i32, i32 }\n';

    // Define Set struct type: { i32* values, i32 size, i32 capacity }
    ir += '%Set = type { i32*, i32, i32 }\n\n';

    // Declare external C functions for string operations
    ir += 'declare i8* @malloc(i64)\n';
    ir += 'declare void @free(i8*)\n';
    ir += 'declare i8* @strcpy(i8*, i8*)\n';
    ir += 'declare i8* @strcat(i8*, i8*)\n';
    ir += 'declare i64 @strlen(i8*)\n';
    ir += 'declare void @llvm.memcpy.p0i8.p0i8.i64(i8*, i8*, i64, i1)\n';
    ir += '\n';

    // Generate external function declarations for imports
    for (const funcName of this.externalFunctions) {
      ir += `declare i32 @${funcName}(...)\n`;
    }
    if (this.externalFunctions.size > 0) {
      ir += '\n';
    }

    // Generate class definitions
    for (const classNode of this.ast.classes) {
      this.syncStateToGenerators();
      ir += this.classGen.generateClass(classNode);
      ir += '\n';
    }

    // Generate function definitions
    for (const func of this.ast.functions) {
      ir += this.generateFunction(func);
      ir += '\n';
    }

    // Generate main function
    ir += this.generateMain();

    // Add global string constants at the beginning
    if (this.globalStrings.length > 0) {
      ir = this.globalStrings.join('\n') + '\n\n' + ir;
    }

    return ir;
  }

  private generateFunction(func: FunctionNode): string {
    this.reset();
    this.syncStateToGenerators();

    let ir = `define i32 @${func.name}(`;
    ir += func.params.map((_, i) => `i32 %arg${i}`).join(', ');
    ir += ') {\n';
    ir += 'entry:\n';

    // Allocate stack space for parameters so they can be treated like variables
    for (let i = 0; i < func.params.length; i++) {
      const paramName = func.params[i];
      const allocaReg = this.nextTemp();
      this.variables.set(paramName, allocaReg);
      this.emit(`${allocaReg} = alloca i32`);
      this.emit(`store i32 %arg${i}, i32* ${allocaReg}`);
    }

    // Generate body
    const result = this.generateBlock(func.body, func.params);

    // Add any instructions that were generated
    if (this.output.length > 0) {
      ir += this.output.map(line => '  ' + line).join('\n') + '\n';
    }

    // If block returned a value, use it; otherwise return 0
    if (result !== null) {
      ir += `  ret i32 ${result}\n`;
    } else {
      ir += '  ret i32 0\n';
    }
    ir += '}\n';

    return ir;
  }

  private generateBlock(block: BlockStatement, params: string[]): string | null {
    let lastValue: string | null = null;

    // Sync thisPointer from classGen if it's set (for constructor/method contexts)
    if (this.classGen.thisPointer !== null) {
      this.thisPointer = this.classGen.thisPointer;
    }

    for (const stmt of block.statements) {
      if (stmt.type === 'variable_declaration') {
        // Determine if this is a string, array, object, map, set, class instance, or numeric value
        const isString = this.isStringExpression(stmt.value);
        const isArray = this.isArrayExpression(stmt.value);
        const isObject = this.isObjectExpression(stmt.value);
        const isMap = this.isMapExpression(stmt.value);
        const isSet = this.isSetExpression(stmt.value);
        const isClassInstance = this.isClassInstanceExpression(stmt.value);

        if (isClassInstance) {
          // Allocate stack space for class instance pointer (i32*)
          const allocaReg = this.nextTemp();
          const newExpr = stmt.value as any as NewNode;
          this.classInstanceVariables.set(stmt.name, { ptr: allocaReg, className: newExpr.className });
          this.emit(`${allocaReg} = alloca i32*`);

          // Generate the new expression and store it
          const instancePtr = this.generateExpression(stmt.value, params);
          this.emit(`store i32* ${instancePtr}, i32** ${allocaReg}`);
        } else if (isObject) {
          // Allocate stack space for object pointer (i32*) BEFORE generating the expression
          const allocaReg = this.nextTemp();
          const keys = (stmt.value as any).type === 'object' ? (stmt.value as any).properties.map((p: any) => p.key) : [];
          this.objectVariables.set(stmt.name, { ptr: allocaReg, keys });
          this.emit(`${allocaReg} = alloca i32*`);

          // Now generate the expression
          const objExpr = this.generateExpression(stmt.value, params);
          this.emit(`store i32* ${objExpr}, i32** ${allocaReg}`);
        } else if (isMap) {
          // Allocate stack space for map struct (%Map*)
          const allocaReg = this.nextTemp();
          this.mapVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca %Map`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          // value is a %Map*, copy the struct
          const loadedMap = this.nextTemp();
          this.emit(`${loadedMap} = load %Map, %Map* ${value}`);
          this.emit(`store %Map ${loadedMap}, %Map* ${allocaReg}`);
        } else if (isSet) {
          // Allocate stack space for set struct (%Set*)
          const allocaReg = this.nextTemp();
          this.setVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca %Set`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          // value is a %Set*, copy the struct
          const loadedSet = this.nextTemp();
          this.emit(`${loadedSet} = load %Set, %Set* ${value}`);
          this.emit(`store %Set ${loadedSet}, %Set* ${allocaReg}`);
        } else if (isArray) {
          // Allocate stack space for array struct (%Array*)
          const allocaReg = this.nextTemp();
          this.arrayVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca %Array`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          // value is a %Array*, copy the struct
          const loadedArray = this.nextTemp();
          this.emit(`${loadedArray} = load %Array, %Array* ${value}`);
          this.emit(`store %Array ${loadedArray}, %Array* ${allocaReg}`);
        } else if (isString) {
          // Allocate stack space for string pointer (i8*)
          const allocaReg = this.nextTemp();
          this.stringVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i8*`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i8* ${value}, i8** ${allocaReg}`);
        } else {
          // Allocate stack space for i32
          const allocaReg = this.nextTemp();
          this.variables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i32`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i32 ${value}, i32* ${allocaReg}`);
        }
      } else if (stmt.type === 'assignment') {
        // Check if this is a member access assignment (this.field = value)
        if (stmt.name.startsWith('__member_access__')) {
          // Extract property name and handle member access assignment
          const memberAccessValue = stmt.value as any;
          if (memberAccessValue.type === 'member_access_assignment') {
            const object = memberAccessValue.object;
            const property = memberAccessValue.property;
            const value = this.generateExpression(memberAccessValue.value, params);
            
            // Get instance pointer
            let instancePtr: string | null = null;
            let className: string | null = null;
            
            if (object.type === 'variable' && this.classInstanceVariables.has(object.name)) {
              const classMeta = this.classInstanceVariables.get(object.name)!;
              className = classMeta.className;
              instancePtr = this.generateExpression(object, params);
            } else if ((object as any).type === 'new') {
              const newExpr = object as any as NewNode;
              className = newExpr.className;
              instancePtr = this.generateExpression(object, params);
            } else if ((object as any).type === 'this') {
              if (!this.thisPointer) {
                throw new Error('this.field = value used outside of class method or constructor');
              }
              instancePtr = this.thisPointer;
              // Find class - simplified for now
              const classWithField = this.ast.classes.find(c => true);
              if (classWithField) {
                className = classWithField.name;
              }
            } else {
              throw new Error(`Cannot assign to property of ${object.type}`);
            }
            
            if (instancePtr && className) {
              // For now, use field index 0 - TODO: implement proper field name mapping
              const fieldIndex = 0;
              const fieldPtr = this.nextTemp();
              this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${instancePtr}, i32 ${fieldIndex}`);
              this.emit(`store i32 ${value}, i32* ${fieldPtr}`);
            } else {
              throw new Error('Could not determine class instance for field assignment');
            }
          } else {
            throw new Error('Invalid member access assignment format');
          }
        } else {
          // Regular variable assignment
          const allocaReg = this.variables.get(stmt.name);
          if (!allocaReg) {
            throw new Error(`Unknown variable: ${stmt.name}`);
          }
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i32 ${value}, i32* ${allocaReg}`);
        }
      } else if (stmt.type === 'return') {
        lastValue = this.generateExpression(stmt.value, params);
      } else if (stmt.type === 'if') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateIfStatement(stmt, params);
        // Don't need to sync back - counters are already shared via bound methods
      } else if (stmt.type === 'while') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateWhileStatement(stmt, params);
      } else if (stmt.type === 'for') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateForStatement(stmt, params);
      } else {
        // Expression statement
        lastValue = this.generateExpression(stmt, params);
      }
    }

    return lastValue;
  }

  private generateExpression(expr: Expression, params: string[]): string {
    if (expr.type === 'number') {
      return expr.value.toString();
    }

    if (expr.type === 'string') {
      this.syncStateToGenerators();
      return this.stringGen.createStringConstant(expr.value);
    }

    if (expr.type === 'array') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayLiteral(expr, params);
    }

    if ((expr as any).type === 'object') {
      this.syncStateToGenerators();
      return this.objectGen.generateObjectLiteral(expr, params);
    }

    if ((expr as any).type === 'map') {
      this.syncStateToGenerators();
      return this.mapGen.generateMapLiteral(expr, params);
    }

    if ((expr as any).type === 'set') {
      this.syncStateToGenerators();
      return this.setGen.generateSetLiteral(expr, params);
    }

    if ((expr as any).type === 'new') {
      this.syncStateToGenerators();
      const newExpr = expr as any as NewNode;
      return this.classGen.generateNewExpression(newExpr.className, newExpr.args, params);
    }

    if ((expr as any).type === 'this') {
      // Return the current 'this' pointer
      // Check both this.thisPointer and classGen.thisPointer (for constructor/method contexts)
      const thisPtr = this.thisPointer || this.classGen.thisPointer;
      if (!thisPtr) {
        throw new Error('this keyword used outside of class method or constructor');
      }
      return thisPtr;
    }

    if (expr.type === 'variable') {
      // Check if it's a class instance variable
      const classInstanceMeta = this.classInstanceVariables.get(expr.name);
      if (classInstanceMeta) {
        const temp = this.nextTemp();
        this.emit(`${temp} = load i32*, i32** ${classInstanceMeta.ptr}`);
        return temp;
      }

      // Check if it's a map variable
      const mapAllocaReg = this.mapVariables.get(expr.name);
      if (mapAllocaReg) {
        return mapAllocaReg;
      }

      // Check if it's a set variable
      const setAllocaReg = this.setVariables.get(expr.name);
      if (setAllocaReg) {
        return setAllocaReg;
      }

      // Check if it's an array variable
      const arrayAllocaReg = this.arrayVariables.get(expr.name);
      if (arrayAllocaReg) {
        return arrayAllocaReg;
      }

      // Check if it's a string variable
      const stringAllocaReg = this.stringVariables.get(expr.name);
      if (stringAllocaReg) {
        const temp = this.nextTemp();
        this.emit(`${temp} = load i8*, i8** ${stringAllocaReg}`);
        return temp;
      }

      // Check if it's a numeric variable
      const allocaReg = this.variables.get(expr.name);
      if (allocaReg) {
        const temp = this.nextTemp();
        this.emit(`${temp} = load i32, i32* ${allocaReg}`);
        return temp;
      }

      throw new Error(`Unknown variable: ${expr.name}`);
    }

    if (expr.type === 'member_access') {
      // Handle class instance property access (this.field or instance.field)
      let className: string | null = null;
      let instancePtr: string | null = null;

      if (expr.object.type === 'variable' && this.classInstanceVariables.has(expr.object.name)) {
        const classMeta = this.classInstanceVariables.get(expr.object.name)!;
        className = classMeta.className;
        instancePtr = this.generateExpression(expr.object, params);
      } else if ((expr.object as any).type === 'new') {
        const newExpr = expr.object as any as NewNode;
        className = newExpr.className;
        instancePtr = this.generateExpression(expr.object, params);
      } else if ((expr.object as any).type === 'this') {
        // Get this pointer - check both this.thisPointer and classGen.thisPointer
        const thisPtr = this.thisPointer || this.classGen.thisPointer;
        if (!thisPtr) {
          throw new Error('this.field accessed outside of class method or constructor');
        }
        instancePtr = thisPtr;
        // Find which class we're in - we'll need to track this better later
        // For now, search for a class that might have this field
        // This is a simplified approach - in a full implementation we'd track the current class
        const classWithField = this.ast.classes.find(c => {
          // Check if constructor or any method assigns this field
          return c.methods.some(m => {
            // Simple check - look for assignment statements with this.field
            // For now, we'll just assume any class could have this field
            return true;
          });
        });
        if (classWithField) {
          className = classWithField.name;
        }
      }

      if (className && instancePtr) {
        // For now, use a simple field index mapping
        // We'll use field index 0 for the first field, 1 for second, etc.
        // This is a simplified approach - in a full implementation we'd track field names
        // For now, let's use field index 0 for any property access
        // TODO: Implement proper field name to index mapping
        const fieldIndex = 0; // Simplified - should track actual field indices
        
        // Get pointer to field
        const fieldPtr = this.nextTemp();
        this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${instancePtr}, i32 ${fieldIndex}`);
        
        // Load field value
        const value = this.nextTemp();
        this.emit(`${value} = load i32, i32* ${fieldPtr}`);
        return value;
      }

      // Check if accessing an object property (variable or literal)
      let objPtr: string;
      let keys: string[];

      if (expr.object.type === 'variable' && this.objectVariables.has(expr.object.name)) {
        // Object stored in variable
        const objMeta = this.objectVariables.get(expr.object.name)!;
        keys = objMeta.keys;
        
        // Load object pointer
        const objPtrPtr = objMeta.ptr;
        objPtr = this.nextTemp();
        this.emit(`${objPtr} = load i32*, i32** ${objPtrPtr}`);
      } else if ((expr.object as any).type === 'object') {
        // Object literal - generate it and extract keys
        const objExpr = expr.object as any;
        keys = objExpr.properties.map((p: any) => p.key);
        objPtr = this.generateExpression(expr.object, params);
      } else {
        // Not an object, fall through to .length handling
        keys = [];
        objPtr = '';
      }

      // If we have an object, access its property
      if (keys.length > 0 && objPtr) {
        const propIndex = keys.indexOf(expr.property);
        if (propIndex === -1) {
          const objDesc = expr.object.type === 'variable' ? expr.object.name : 'literal';
          throw new Error(`Unknown property: ${expr.property} on object ${objDesc}`);
        }

        // Get pointer to property field
        const fieldPtr = this.nextTemp();
        this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${objPtr}, i32 ${propIndex}`);

        // Load property value
        const value = this.nextTemp();
        this.emit(`${value} = load i32, i32* ${fieldPtr}`);
        return value;
      }

      // Handle .length property
      if (expr.property === 'length') {
        // Check if it's an array
        if (expr.object.type === 'variable' && this.arrayVariables.has(expr.object.name)) {
          const arrayPtr = this.generateExpression(expr.object, params);
          const lenPtr = this.nextTemp();
          this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
          const len = this.nextTemp();
          this.emit(`${len} = load i32, i32* ${lenPtr}`);
          return len;
        } else {
          // String length
          const objPtr = this.generateExpression(expr.object, params);
          const lenI64 = this.nextTemp();
          this.emit(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
          const lenI32 = this.nextTemp();
          this.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
          return lenI32;
        }
      }

      // Handle .size property (for Map and Set)
      if (expr.property === 'size') {
        // Check if it's a Map
        if (expr.object.type === 'variable' && this.mapVariables.has(expr.object.name)) {
          const mapPtr = this.generateExpression(expr.object, params);
          this.syncStateToGenerators();
          return this.mapGen.generateMapSize(mapPtr);
        }
        // Check if it's a Set
        if (expr.object.type === 'variable' && this.setVariables.has(expr.object.name)) {
          const setPtr = this.generateExpression(expr.object, params);
          this.syncStateToGenerators();
          return this.setGen.generateSetSize(setPtr);
        }
      }
      throw new Error(`Unknown property: ${expr.property}`);
    }

    if (expr.type === 'index_access') {
      // Check if it's an array
      if (expr.object.type === 'variable' && this.arrayVariables.has(expr.object.name)) {
        const arrayPtr = this.generateExpression(expr.object, params);
        const index = this.generateExpression(expr.index, params);

        const dataPtr = this.nextTemp();
        this.emit(`${dataPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);

        const data = this.nextTemp();
        this.emit(`${data} = load i32*, i32** ${dataPtr}`);

        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${data}, i32 ${index}`);

        const elem = this.nextTemp();
        this.emit(`${elem} = load i32, i32* ${elemPtr}`);
        return elem;
      } else {
        // Handle string[index] - returns character code as i32
        const objPtr = this.generateExpression(expr.object, params);
        const index = this.generateExpression(expr.index, params);

        const indexI64 = this.nextTemp();
        this.emit(`${indexI64} = sext i32 ${index} to i64`);

        const charPtr = this.nextTemp();
        this.emit(`${charPtr} = getelementptr inbounds i8, i8* ${objPtr}, i64 ${indexI64}`);

        const charI8 = this.nextTemp();
        this.emit(`${charI8} = load i8, i8* ${charPtr}`);

        const charI32 = this.nextTemp();
        this.emit(`${charI32} = zext i8 ${charI8} to i32`);

        return charI32;
      }
    }

    if (expr.type === 'unary') {
      const operand = this.generateExpression(expr.operand, params);

      if (expr.op === '!') {
        const cmpResult = this.nextTemp();
        this.emit(`${cmpResult} = icmp eq i32 ${operand}, 0`);
        const result = this.nextTemp();
        this.emit(`${result} = zext i1 ${cmpResult} to i32`);
        return result;
      }

      throw new Error(`Unknown unary operator: ${expr.op}`);
    }

    if (expr.type === 'binary') {
      // Logical operators need short-circuit evaluation
      if (expr.op === '&&' || expr.op === '||') {
        this.syncStateToGenerators();
        return this.controlFlowGen.generateLogicalOp(expr.op, expr.left, expr.right, params);
      }

      // Check for string concatenation (+ with at least one string operand)
      if (expr.op === '+' && (this.isStringExpression(expr.left) || this.isStringExpression(expr.right))) {
        this.syncStateToGenerators();
        return this.stringGen.generateStringConcat(expr.left, expr.right, params);
      }

      // Arithmetic operators
      const arithMap: { [key: string]: string } = {
        '+': 'add',
        '-': 'sub',
        '*': 'mul',
        '/': 'sdiv'
      };

      // Comparison operators (icmp returns i1, need to extend to i32)
      const cmpMap: { [key: string]: string } = {
        '<': 'slt',
        '>': 'sgt',
        '<=': 'sle',
        '>=': 'sge',
        '==': 'eq',
        '!=': 'ne'
      };

      const left = this.generateExpression(expr.left, params);
      const right = this.generateExpression(expr.right, params);

      if (arithMap[expr.op]) {
        const temp = this.nextTemp();
        const op = arithMap[expr.op];
        this.emit(`${temp} = ${op} i32 ${left}, ${right}`);
        return temp;
      } else if (cmpMap[expr.op]) {
        const cond = cmpMap[expr.op];
        const cmpResult = this.nextTemp();
        this.emit(`${cmpResult} = icmp ${cond} i32 ${left}, ${right}`);
        const extResult = this.nextTemp();
        this.emit(`${extResult} = zext i1 ${cmpResult} to i32`);
        return extResult;
      } else {
        throw new Error(`Unknown operator: ${expr.op}`);
      }
    }

    if (expr.type === 'call') {
      const args = expr.args.map(arg => {
        const result = this.generateExpression(arg, params);
        return `i32 ${result}`;
      }).join(', ');

      const temp = this.nextTemp();
      this.emit(`${temp} = call i32 @${expr.name}(${args})`);

      return temp;
    }

    if (expr.type === 'method_call') {
      return this.generateMethodCall(expr, params);
    }

    throw new Error(`Unknown expression type: ${(expr as any).type}`);
  }

  private generateMethodCall(expr: MethodCallNode, params: string[]): string {
    const method = expr.method;

    // Handle Map methods
    if (method === 'set' || method === 'get' || method === 'has') {
      // Check if the object is a Map
      if (expr.object.type === 'variable' && this.mapVariables.has(expr.object.name)) {
        this.syncStateToGenerators();
        if (method === 'set') {
          return this.mapGen.generateMapSet(expr, params);
        } else if (method === 'get') {
          return this.mapGen.generateMapGet(expr, params);
        } else {
          return this.mapGen.generateMapHas(expr, params);
        }
      }
    }

    // Handle Set methods
    if (method === 'add' || method === 'has' || method === 'delete') {
      // Check if the object is a Set
      if (expr.object.type === 'variable' && this.setVariables.has(expr.object.name)) {
        this.syncStateToGenerators();
        if (method === 'add') {
          return this.setGen.generateSetAdd(expr, params);
        } else if (method === 'has') {
          return this.setGen.generateSetHas(expr, params);
        } else {
          return this.setGen.generateSetDelete(expr, params);
        }
      }
    }

    // Handle array methods
    if (method === 'push') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayPush(expr, params);
    } else if (method === 'map') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayMap(expr, params);
    } else if (method === 'join') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayJoin(expr, params);
    } else if (method === 'find') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayFind(expr, params);
    } else if (method === 'some') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArraySome(expr, params);
    } else if (method === 'filter') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayFilter(expr, params);
    } else if (method === 'forEach') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayForEach(expr, params);
    }

    // Handle class instance methods
    let className: string | null = null;
    let instancePtr: string | null = null;
    
    if (expr.object.type === 'variable' && this.classInstanceVariables.has(expr.object.name)) {
      const classMeta = this.classInstanceVariables.get(expr.object.name)!;
      className = classMeta.className;
      instancePtr = this.generateExpression(expr.object, params);
    } else if ((expr.object as any).type === 'new') {
      const newExpr = expr.object as any as NewNode;
      className = newExpr.className;
      instancePtr = this.generateExpression(expr.object, params);
    } else if ((expr.object as any).type === 'this') {
      // Method call on 'this' - need to find the class context
      if (!this.thisPointer) {
        throw new Error('this.method() called outside of class method');
      }
      instancePtr = this.thisPointer;
      // Find the class that contains the current method - we'll need to track this
      // For now, we'll search for a class with this method
      const classWithMethod = this.ast.classes.find(c => 
        c.methods.some(m => m.name === method && !m.isConstructor)
      );
      if (!classWithMethod) {
        throw new Error(`Method ${method} not found in any class`);
      }
      className = classWithMethod.name;
    }

    if (className && instancePtr) {
      // Check if the class has this method
      const classNode = this.ast.classes.find(c => c.name === className);
      if (!classNode) {
        throw new Error(`Class ${className} not found`);
      }
      const methodExists = classNode.methods.some(m => m.name === method && !m.isConstructor);
      if (!methodExists) {
        throw new Error(`Method ${method} not found in class ${className}`);
      }

      this.syncStateToGenerators();
      return this.classGen.generateMethodCall(instancePtr, className, method, expr.args, params);
    }

    // Handle object methods
    // Check if the object is an object (variable or literal) and has the method property
    let isObjectMethod = false;
    if (expr.object.type === 'variable' && this.objectVariables.has(expr.object.name)) {
      const objMeta = this.objectVariables.get(expr.object.name)!;
      isObjectMethod = objMeta.keys.includes(method);
    } else if ((expr.object as any).type === 'object') {
      const objExpr = expr.object as any;
      isObjectMethod = objExpr.properties.some((p: any) => p.key === method);
    }

    if (isObjectMethod) {
      // For object methods, we call the function with the same name as the method
      // This is a simplified implementation - in a full implementation, we'd store function references
      const funcExists = this.ast.functions.some(f => f.name === method);
      if (!funcExists) {
        throw new Error(`Function ${method} not found for object method call`);
      }

      // Generate arguments
      const args = expr.args.map(arg => {
        const result = this.generateExpression(arg, params);
        return `i32 ${result}`;
      }).join(', ');

      const temp = this.nextTemp();
      this.emit(`${temp} = call i32 @${method}(${args})`);
      return temp;
    }

    throw new Error(`Unknown method: ${method}`);
  }

  private isArrayExpression(expr: Expression): boolean {
    if (expr.type === 'array') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.arrayVariables.has(expr.name);
    }
    // Check if it's a method call that returns an array (e.g., .filter())
    if (expr.type === 'method_call') {
      const method = (expr as any).method;
      return method === 'filter'; // filter() returns a new array
    }
    return false;
  }

  private isObjectExpression(expr: Expression): boolean {
    if ((expr as any).type === 'object') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.objectVariables.has(expr.name);
    }
    return false;
  }

  private isMapExpression(expr: Expression): boolean {
    if ((expr as any).type === 'map') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.mapVariables.has(expr.name);
    }
    return false;
  }

  private isSetExpression(expr: Expression): boolean {
    if ((expr as any).type === 'set') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.setVariables.has(expr.name);
    }
    return false;
  }

  private isStringExpression(expr: Expression): boolean {
    if (expr.type === 'string') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.stringVariables.has(expr.name);
    }
    if (expr.type === 'binary' && expr.op === '+') {
      return this.isStringExpression(expr.left) || this.isStringExpression(expr.right);
    }
    return false;
  }

  private isClassInstanceExpression(expr: Expression): boolean {
    if ((expr as any).type === 'new') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.classInstanceVariables.has(expr.name);
    }
    return false;
  }

  private generateMain(): string {
    let ir = 'define i32 @main() {\n';
    ir += 'entry:\n';

    if (this.ast.entryPoint) {
      this.tempCounter = 0;
      this.output = [];

      const result = this.generateExpression(this.ast.entryPoint, []);

      if (this.output.length > 0) {
        ir += this.output.map(line => '  ' + line).join('\n') + '\n';
      }

      ir += `  ret i32 ${result}\n`;
    } else {
      ir += '  ret i32 0\n';
    }

    ir += '}\n';

    return ir;
  }

  // Sync state to sub-generators - share Maps/arrays by reference
  // Note: Counters are already shared via bound methods (nextTemp, nextLabel, nextString)
  private syncStateToGenerators() {
    for (const gen of [this.arrayGen, this.stringGen, this.objectGen, this.mapGen, this.setGen, this.controlFlowGen, this.classGen]) {
      gen.output = this.output;
      gen.globalStrings = this.globalStrings;
      gen.variables = this.variables;
      gen.stringVariables = this.stringVariables;
      gen.arrayVariables = this.arrayVariables;
      gen.objectVariables = this.objectVariables;
      gen.mapVariables = this.mapVariables;
      gen.setVariables = this.setVariables;
      gen.classInstanceVariables = this.classInstanceVariables;
      gen.thisPointer = this.thisPointer;
    }
  }

  // Sync state FROM generators back to this (for thisPointer updates)
  private syncStateFromGenerators() {
    // Sync thisPointer from classGen back to this
    if (this.classGen.thisPointer !== null) {
      this.thisPointer = this.classGen.thisPointer;
    }
  }
}
