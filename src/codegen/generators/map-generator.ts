import { Expression, MethodCallNode } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// MAP GENERATOR - Map operations
// ============================================

// Map structure in LLVM:
// %Map = type { i32*, i32*, i32, i32 }
// - i32* keys   - pointer to key array
// - i32* values - pointer to value array
// - i32 size    - number of entries
// - i32 capacity - allocated capacity

export class MapGenerator extends BaseGenerator {
  // Generate delegate for expressions (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;

  constructor() {
    super();
  }

  generateMapLiteral(expr: Expression, params: string[]): string {
    const mapExpr = expr as any;
    if (mapExpr.type !== 'map') {
      throw new Error('Expected map literal');
    }

    // Allocate Map struct on stack
    const mapPtr = this.nextTemp();
    this.emit(`${mapPtr} = alloca %Map`);

    // Initialize with empty arrays
    const initialCapacity = mapExpr.entries.length > 4 ? mapExpr.entries.length : 4;

    // Allocate keys array
    const keysSize = this.nextTemp();
    this.emit(`${keysSize} = mul i64 ${initialCapacity}, 4`);
    const keysMem = this.nextTemp();
    this.emit(`${keysMem} = call i8* @malloc(i64 ${keysSize})`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = bitcast i8* ${keysMem} to i32*`);

    // Allocate values array
    const valuesSize = this.nextTemp();
    this.emit(`${valuesSize} = mul i64 ${initialCapacity}, 4`);
    const valuesMem = this.nextTemp();
    this.emit(`${valuesMem} = call i8* @malloc(i64 ${valuesSize})`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = bitcast i8* ${valuesMem} to i32*`);

    // Store keys pointer in Map struct
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    this.emit(`store i32* ${keysPtr}, i32** ${keysFieldPtr}`);

    // Store values pointer in Map struct
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    this.emit(`store i32* ${valuesPtr}, i32** ${valuesFieldPtr}`);

    // Store size
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${mapExpr.entries.length}, i32* ${sizeFieldPtr}`);

    // Store capacity
    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 3`);
    this.emit(`store i32 ${initialCapacity}, i32* ${capacityFieldPtr}`);

    // Populate initial entries
    for (let i = 0; i < mapExpr.entries.length; i++) {
      const keyValue = this.generateExpression(mapExpr.entries[i].key, params);
      const valueValue = this.generateExpression(mapExpr.entries[i].value, params);

      // Store key
      const keyElemPtr = this.nextTemp();
      this.emit(`${keyElemPtr} = getelementptr inbounds i32, i32* ${keysPtr}, i32 ${i}`);
      this.emit(`store i32 ${keyValue}, i32* ${keyElemPtr}`);

      // Store value
      const valueElemPtr = this.nextTemp();
      this.emit(`${valueElemPtr} = getelementptr inbounds i32, i32* ${valuesPtr}, i32 ${i}`);
      this.emit(`store i32 ${valueValue}, i32* ${valueElemPtr}`);
    }

    return mapPtr;
  }

  generateMapSet(expr: MethodCallNode, params: string[]): string {
    // map.set(key, value)
    if (expr.args.length !== 2) {
      throw new Error('Map.set() requires exactly 2 arguments');
    }

    // Get map pointer
    const mapPtr = this.generateExpression(expr.object, params);

    // Generate key and value
    const keyValue = this.generateExpression(expr.args[0], params);
    const valueValue = this.generateExpression(expr.args[1], params);

    // Load current arrays and size
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i32*, i32** ${keysFieldPtr}`);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i32*, i32** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const currentSize = this.nextTemp();
    this.emit(`${currentSize} = load i32, i32* ${sizeFieldPtr}`);

    // For simplicity, assume we're adding a new entry (not updating)
    // Store key at index = currentSize
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i32, i32* ${keysPtr}, i32 ${currentSize}`);
    this.emit(`store i32 ${keyValue}, i32* ${keyElemPtr}`);

    // Store value at index = currentSize
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i32, i32* ${valuesPtr}, i32 ${currentSize}`);
    this.emit(`store i32 ${valueValue}, i32* ${valueElemPtr}`);

    // Increment size
    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.emit(`store i32 ${newSize}, i32* ${sizeFieldPtr}`);

    // Return the map (for chaining)
    return mapPtr;
  }

  generateMapGet(expr: MethodCallNode, params: string[]): string {
    // map.get(key)
    if (expr.args.length !== 1) {
      throw new Error('Map.get() requires exactly 1 argument');
    }

    // Get map pointer
    const mapPtr = this.generateExpression(expr.object, params);

    // Generate key
    const keyToFind = this.generateExpression(expr.args[0], params);

    // Load arrays and size
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i32*, i32** ${keysFieldPtr}`);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i32*, i32** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    // For simplicity, linear search (in production, use hash table)
    // We'll just return the first matching key's value, or 0 if not found
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${resultReg}`); // Default to 0

    // Generate loop to search for key
    const loopLabel = this.nextLabel('map_has_loop');
    const bodyLabel = this.nextLabel('map_has_body');
    const foundLabel = this.nextLabel('map_has_found');
    const endLabel = this.nextLabel('map_has_end');

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${loopLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexReg}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${currentIndex}, ${mapSize}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i32, i32* ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.nextTemp();
    this.emit(`${keyValue} = load i32, i32* ${keyElemPtr}`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i32 ${keyValue}, ${keyToFind}`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${loopLabel}_next`);

    this.emit(`${foundLabel}:`);
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i32, i32* ${valuesPtr}, i32 ${currentIndex}`);
    const foundValue = this.nextTemp();
    this.emit(`${foundValue} = load i32, i32* ${valueElemPtr}`);
    this.emit(`store i32 ${foundValue}, i32* ${resultReg}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load i32, i32* ${resultReg}`);

    return result;
  }

  generateMapHas(expr: MethodCallNode, params: string[]): string {
    // map.has(key) - returns 1 if key exists, 0 otherwise
    if (expr.args.length !== 1) {
      throw new Error('Map.has() requires exactly 1 argument');
    }

    // Get map pointer
    const mapPtr = this.generateExpression(expr.object, params);

    // Generate key
    const keyToFind = this.generateExpression(expr.args[0], params);

    // Load arrays and size
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i32*, i32** ${keysFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    // Linear search for key
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${resultReg}`);

    const loopLabel = this.nextLabel('map_get_loop');
    const bodyLabel = this.nextLabel('map_get_body');
    const foundLabel = this.nextLabel('map_get_found');
    const endLabel = this.nextLabel('map_get_end');

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${loopLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexReg}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${currentIndex}, ${mapSize}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i32, i32* ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.nextTemp();
    this.emit(`${keyValue} = load i32, i32* ${keyElemPtr}`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i32 ${keyValue}, ${keyToFind}`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${loopLabel}_next`);

    this.emit(`${foundLabel}:`);
    this.emit(`store i32 1, i32* ${resultReg}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load i32, i32* ${resultReg}`);

    return result;
  }

  generateMapSize(mapPtr: string): string {
    // Get size field
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const size = this.nextTemp();
    this.emit(`${size} = load i32, i32* ${sizeFieldPtr}`);
    return size;
  }
}
