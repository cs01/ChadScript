import { Expression, MethodCallNode, MapEntry } from '../../../ast/types.js';
import { IGeneratorContext } from '../../infrastructure/generator-context.js';

// ============================================
// MAP GENERATOR - Map operations
// ============================================

// Map structure in LLVM:
// %Map = type { double*, double*, i32, i32 }
// - double* keys   - pointer to key array (JavaScript semantics)
// - double* values - pointer to value array (JavaScript semantics)
// - i32 size    - number of entries
// - i32 capacity - allocated capacity

export class MapGenerator {
  constructor(private ctx: IGeneratorContext) {}

  // Helper methods delegate to context
  private nextTemp(): string { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string): string { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }
  private getDoubleSize() { return 8; } // sizeof(double) = 8 bytes

  generateMapLiteral(expr: Expression, params: string[]): string {
    const mapExpr = expr as { type: string; entries: MapEntry[] };
    if (mapExpr.type !== 'map') {
      throw new Error('Expected map literal');
    }

    // Allocate Map struct on heap (not stack!)
    const sizeofPtr = this.nextTemp();
    this.emit(`${sizeofPtr} = getelementptr %Map, %Map* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint %Map* ${sizeofPtr} to i64`);
    const mapMem = this.nextTemp();
    this.emit(`${mapMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const mapPtr = this.nextTemp();
    this.emit(`${mapPtr} = bitcast i8* ${mapMem} to %Map*`);

    // Initialize with empty arrays
    const initialCapacity = mapExpr.entries.length > 4 ? mapExpr.entries.length : 4;

    // Allocate keys array - use double* for JavaScript semantics
    const doubleSize = this.getDoubleSize();
    const keysCapI64 = this.nextTemp();
    this.emit(`${keysCapI64} = zext i32 ${initialCapacity} to i64`);
    const keysSize = this.nextTemp();
    this.emit(`${keysSize} = mul i64 ${keysCapI64}, ${doubleSize}`);
    const keysMem = this.nextTemp();
    this.emit(`${keysMem} = call i8* @GC_malloc_atomic(i64 ${keysSize})`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = bitcast i8* ${keysMem} to double*`);

    // Allocate values array - use double* for JavaScript semantics
    const valuesCapI64 = this.nextTemp();
    this.emit(`${valuesCapI64} = zext i32 ${initialCapacity} to i64`);
    const valuesSize = this.nextTemp();
    this.emit(`${valuesSize} = mul i64 ${valuesCapI64}, ${doubleSize}`);
    const valuesMem = this.nextTemp();
    this.emit(`${valuesMem} = call i8* @GC_malloc_atomic(i64 ${valuesSize})`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = bitcast i8* ${valuesMem} to double*`);

    // Store keys pointer in Map struct
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    this.emit(`store double* ${keysPtr}, double** ${keysFieldPtr}`);

    // Store values pointer in Map struct
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    this.emit(`store double* ${valuesPtr}, double** ${valuesFieldPtr}`);

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
      const entry = mapExpr.entries[i] as MapEntry;
      const keyValue = this.ctx.generateExpression(entry.key, params);
      const valueValue = this.ctx.generateExpression(entry.value, params);

      // Store key
      const keyElemPtr = this.nextTemp();
      this.emit(`${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${i}`);
      this.emit(`store double ${keyValue}, double* ${keyElemPtr}`);

      // Store value
      const valueElemPtr = this.nextTemp();
      this.emit(`${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${i}`);
      this.emit(`store double ${valueValue}, double* ${valueElemPtr}`);
    }

    this.ctx.setVariableType(mapPtr, '%Map*');
    return mapPtr;
  }

  generateMapSet(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 2) {
      throw new Error('Map.set() requires exactly 2 arguments');
    }

    const mapPtr = this.ctx.generateExpression(expr.object, params);
    const keyValue = this.ctx.generateExpression(expr.args[0], params);
    const valueValue = this.ctx.generateExpression(expr.args[1], params);

    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load double*, double** ${keysFieldPtr}`);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load double*, double** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const currentSize = this.nextTemp();
    this.emit(`${currentSize} = load i32, i32* ${sizeFieldPtr}`);

    const searchLoopLabel = this.nextLabel('map_set_search');
    const searchBodyLabel = this.nextLabel('map_set_body');
    const foundLabel = this.nextLabel('map_set_found');
    const notFoundLabel = this.nextLabel('map_set_notfound');
    const insertLabel = this.nextLabel('map_set_insert');
    const endLabel = this.nextLabel('map_set_end');

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexReg}`);
    this.emit(`br label %${searchLoopLabel}`);

    this.emit(`${searchLoopLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexReg}`);
    const searchCond = this.nextTemp();
    this.emit(`${searchCond} = icmp slt i32 ${currentIndex}, ${currentSize}`);
    this.emit(`br i1 ${searchCond}, label %${searchBodyLabel}, label %${notFoundLabel}`);

    this.emit(`${searchBodyLabel}:`);
    const keyElemPtrSearch = this.nextTemp();
    this.emit(`${keyElemPtrSearch} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`);
    const keyAtIndex = this.nextTemp();
    this.emit(`${keyAtIndex} = load double, double* ${keyElemPtrSearch}`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = fcmp oeq double ${keyAtIndex}, ${keyValue}`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${searchLoopLabel}_next`);

    this.emit(`${searchLoopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${searchLoopLabel}`);

    this.emit(`${foundLabel}:`);
    const foundIdx = this.nextTemp();
    this.emit(`${foundIdx} = load i32, i32* ${indexReg}`);
    const valueElemPtrFound = this.nextTemp();
    this.emit(`${valueElemPtrFound} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${foundIdx}`);
    this.emit(`store double ${valueValue}, double* ${valueElemPtrFound}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${notFoundLabel}:`);
    this.emit(`br label %${insertLabel}`);

    this.emit(`${insertLabel}:`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentSize}`);
    this.emit(`store double ${keyValue}, double* ${keyElemPtr}`);

    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${currentSize}`);
    this.emit(`store double ${valueValue}, double* ${valueElemPtr}`);

    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.emit(`store i32 ${newSize}, i32* ${sizeFieldPtr}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${endLabel}:`);

    return mapPtr;
  }

  generateMapGet(expr: MethodCallNode, params: string[]): string {
    // map.get(key)
    if (expr.args.length !== 1) {
      throw new Error('Map.get() requires exactly 1 argument');
    }

    // Get map pointer
    const mapPtr = this.ctx.generateExpression(expr.object, params);

    // Generate key
    const keyToFind = this.ctx.generateExpression(expr.args[0], params);

    // Load arrays and size
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load double*, double** ${keysFieldPtr}`);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load double*, double** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    // For simplicity, linear search (in production, use hash table)
    // We'll just return the first matching key's value, or 0 if not found
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.emit(`store double 0.0, double* ${resultReg}`); // Default to 0

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
    this.emit(`${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.nextTemp();
    this.emit(`${keyValue} = load double, double* ${keyElemPtr}`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = fcmp oeq double ${keyValue}, ${keyToFind}`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${loopLabel}_next`);

    this.emit(`${foundLabel}:`);
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${currentIndex}`);
    const foundValue = this.nextTemp();
    this.emit(`${foundValue} = load double, double* ${valueElemPtr}`);
    this.emit(`store double ${foundValue}, double* ${resultReg}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load double, double* ${resultReg}`);

    return result;
  }

  generateMapHas(expr: MethodCallNode, params: string[]): string {
    // map.has(key) - returns 1 if key exists, 0 otherwise
    if (expr.args.length !== 1) {
      throw new Error('Map.has() requires exactly 1 argument');
    }

    // Get map pointer
    const mapPtr = this.ctx.generateExpression(expr.object, params);

    // Generate key
    const keyToFind = this.ctx.generateExpression(expr.args[0], params);

    // Load arrays and size
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load double*, double** ${keysFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    // Linear search for key
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.emit(`store double 0.0, double* ${resultReg}`);

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
    this.emit(`${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.nextTemp();
    this.emit(`${keyValue} = load double, double* ${keyElemPtr}`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = fcmp oeq double ${keyValue}, ${keyToFind}`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${loopLabel}_next`);

    this.emit(`${foundLabel}:`);
    this.emit(`store double 1.0, double* ${resultReg}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load double, double* ${resultReg}`);

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

  generateMapClear(expr: MethodCallNode, params: string[]): string {
    const mapPtr = this.ctx.generateExpression(expr.object, params);
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    this.emit(`store i32 0, i32* ${sizeFieldPtr}`);
    return '0.0';
  }

  generateMapDelete(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('Map.delete() requires exactly 1 argument');
    }

    const mapPtr = this.ctx.generateExpression(expr.object, params);
    const keyToFind = this.ctx.generateExpression(expr.args[0], params);

    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load double*, double** ${keysFieldPtr}`);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load double*, double** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %Map, %Map* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.emit(`store double 0.0, double* ${resultReg}`);

    const loopLabel = this.nextLabel('map_del_loop');
    const bodyLabel = this.nextLabel('map_del_body');
    const foundLabel = this.nextLabel('map_del_found');
    const shiftLabel = this.nextLabel('map_del_shift');
    const shiftBodyLabel = this.nextLabel('map_del_shift_body');
    const endLabel = this.nextLabel('map_del_end');

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
    this.emit(`${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.nextTemp();
    this.emit(`${keyValue} = load double, double* ${keyElemPtr}`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = fcmp oeq double ${keyValue}, ${keyToFind}`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${loopLabel}_next`);

    this.emit(`${foundLabel}:`);
    this.emit(`store double 1.0, double* ${resultReg}`);
    const newSize = this.nextTemp();
    this.emit(`${newSize} = sub i32 ${mapSize}, 1`);
    this.emit(`store i32 ${newSize}, i32* ${sizeFieldPtr}`);
    const shiftIdx = this.nextTemp();
    this.emit(`${shiftIdx} = alloca i32`);
    const currentIndex2 = this.nextTemp();
    this.emit(`${currentIndex2} = load i32, i32* ${indexReg}`);
    this.emit(`store i32 ${currentIndex2}, i32* ${shiftIdx}`);
    this.emit(`br label %${shiftLabel}`);

    this.emit(`${shiftLabel}:`);
    const shiftI = this.nextTemp();
    this.emit(`${shiftI} = load i32, i32* ${shiftIdx}`);
    const shiftCond = this.nextTemp();
    this.emit(`${shiftCond} = icmp slt i32 ${shiftI}, ${newSize}`);
    this.emit(`br i1 ${shiftCond}, label %${shiftBodyLabel}, label %${endLabel}`);

    this.emit(`${shiftBodyLabel}:`);
    const nextI = this.nextTemp();
    this.emit(`${nextI} = add i32 ${shiftI}, 1`);
    const nextKeyPtr = this.nextTemp();
    this.emit(`${nextKeyPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${nextI}`);
    const nextKey = this.nextTemp();
    this.emit(`${nextKey} = load double, double* ${nextKeyPtr}`);
    const currKeyPtr = this.nextTemp();
    this.emit(`${currKeyPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${shiftI}`);
    this.emit(`store double ${nextKey}, double* ${currKeyPtr}`);
    const nextValPtr = this.nextTemp();
    this.emit(`${nextValPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${nextI}`);
    const nextVal = this.nextTemp();
    this.emit(`${nextVal} = load double, double* ${nextValPtr}`);
    const currValPtr = this.nextTemp();
    this.emit(`${currValPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${shiftI}`);
    this.emit(`store double ${nextVal}, double* ${currValPtr}`);
    this.emit(`store i32 ${nextI}, i32* ${shiftIdx}`);
    this.emit(`br label %${shiftLabel}`);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load double, double* ${resultReg}`);

    return result;
  }
}

export class StringMapGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private nextTemp(): string { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string): string { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }
  private getPtrSize() { return 8; }

  generateEmptyStringMap(): string {
    const sizeofPtr = this.nextTemp();
    this.emit(`${sizeofPtr} = getelementptr %StringMap, %StringMap* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint %StringMap* ${sizeofPtr} to i64`);
    const mapMem = this.nextTemp();
    this.emit(`${mapMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const mapPtr = this.nextTemp();
    this.emit(`${mapPtr} = bitcast i8* ${mapMem} to %StringMap*`);

    const initialCapacity = 16;
    const ptrSize = this.getPtrSize();

    const keysSize = initialCapacity * ptrSize;
    const keysMem = this.nextTemp();
    this.emit(`${keysMem} = call i8* @GC_malloc(i64 ${keysSize})`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = bitcast i8* ${keysMem} to i8**`);

    const valuesMem = this.nextTemp();
    this.emit(`${valuesMem} = call i8* @GC_malloc(i64 ${keysSize})`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = bitcast i8* ${valuesMem} to i8**`);

    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    this.emit(`store i8** ${keysPtr}, i8*** ${keysFieldPtr}`);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`);
    this.emit(`store i8** ${valuesPtr}, i8*** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    this.emit(`store i32 0, i32* ${sizeFieldPtr}`);

    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`);
    this.emit(`store i32 ${initialCapacity}, i32* ${capacityFieldPtr}`);

    this.ctx.setVariableType(mapPtr, '%StringMap*');
    return mapPtr;
  }

  generateStringMapSet(mapPtr: string, keyValue: string, valueValue: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`);
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`);

    const currentSize = this.nextTemp();
    this.emit(`${currentSize} = load i32, i32* ${sizeFieldPtr}`);
    const currentCapacity = this.nextTemp();
    this.emit(`${currentCapacity} = load i32, i32* ${capacityFieldPtr}`);

    const resizeCheckLabel = this.nextLabel('strmap_set_resize_check');
    const resizeLabel = this.nextLabel('strmap_set_resize');
    const probeLabel = this.nextLabel('strmap_set_probe');
    const probeBodyLabel = this.nextLabel('strmap_set_probe_body');
    const foundLabel = this.nextLabel('strmap_set_found');
    const insertLabel = this.nextLabel('strmap_set_insert');
    const endLabel = this.nextLabel('strmap_set_end');

    // Check load factor: if (size+1) * 10 >= capacity * 7, resize before insertion
    const sizeP1 = this.nextTemp();
    this.emit(`${sizeP1} = add i32 ${currentSize}, 1`);
    const sizeTimes10 = this.nextTemp();
    this.emit(`${sizeTimes10} = mul i32 ${sizeP1}, 10`);
    const capTimes7 = this.nextTemp();
    this.emit(`${capTimes7} = mul i32 ${currentCapacity}, 7`);
    const needsResize = this.nextTemp();
    this.emit(`${needsResize} = icmp sge i32 ${sizeTimes10}, ${capTimes7}`);
    this.emit(`br i1 ${needsResize}, label %${resizeLabel}, label %${resizeCheckLabel}`);

    // Resize: double capacity and rehash
    this.emit(`${resizeLabel}:`);
    const newCapacity = this.nextTemp();
    this.emit(`${newCapacity} = shl i32 ${currentCapacity}, 1`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = sext i32 ${newCapacity} to i64`);
    const newArrSize = this.nextTemp();
    this.emit(`${newArrSize} = mul i64 ${newCapI64}, 8`);
    const newKeysMem = this.nextTemp();
    this.emit(`${newKeysMem} = call i8* @GC_malloc(i64 ${newArrSize})`);
    const newKeysPtr = this.nextTemp();
    this.emit(`${newKeysPtr} = bitcast i8* ${newKeysMem} to i8**`);
    const newValuesMem = this.nextTemp();
    this.emit(`${newValuesMem} = call i8* @GC_malloc(i64 ${newArrSize})`);
    const newValuesPtr = this.nextTemp();
    this.emit(`${newValuesPtr} = bitcast i8* ${newValuesMem} to i8**`);

    const oldKeysPtr = this.nextTemp();
    this.emit(`${oldKeysPtr} = load i8**, i8*** ${keysFieldPtr}`);
    const oldValuesPtr = this.nextTemp();
    this.emit(`${oldValuesPtr} = load i8**, i8*** ${valuesFieldPtr}`);

    this.emit(`call void @__strmap_rehash(i8** ${oldKeysPtr}, i8** ${oldValuesPtr}, i32 ${currentCapacity}, i8** ${newKeysPtr}, i8** ${newValuesPtr}, i32 ${newCapacity})`);

    this.emit(`store i8** ${newKeysPtr}, i8*** ${keysFieldPtr}`);
    this.emit(`store i8** ${newValuesPtr}, i8*** ${valuesFieldPtr}`);
    this.emit(`store i32 ${newCapacity}, i32* ${capacityFieldPtr}`);
    this.emit(`br label %${resizeCheckLabel}`);

    // After potential resize, load fresh pointers and capacity
    this.emit(`${resizeCheckLabel}:`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i8**, i8*** ${keysFieldPtr}`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i8**, i8*** ${valuesFieldPtr}`);
    const capacity = this.nextTemp();
    this.emit(`${capacity} = load i32, i32* ${capacityFieldPtr}`);

    // Hash the key and compute initial slot
    const hash = this.nextTemp();
    this.emit(`${hash} = call i32 @__string_hash(i8* ${keyValue})`);
    const mask = this.nextTemp();
    this.emit(`${mask} = sub i32 ${capacity}, 1`);
    const startSlot = this.nextTemp();
    this.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

    // Probe loop
    const slotReg = this.nextTemp();
    this.emit(`${slotReg} = alloca i32`);
    this.emit(`store i32 ${startSlot}, i32* ${slotReg}`);
    this.emit(`br label %${probeLabel}`);

    this.emit(`${probeLabel}:`);
    const slot = this.nextTemp();
    this.emit(`${slot} = load i32, i32* ${slotReg}`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
    const keyAtSlot = this.nextTemp();
    this.emit(`${keyAtSlot} = load i8*, i8** ${keyElemPtr}`);
    const isNull = this.nextTemp();
    this.emit(`${isNull} = icmp eq i8* ${keyAtSlot}, null`);
    this.emit(`br i1 ${isNull}, label %${insertLabel}, label %${probeBodyLabel}`);

    // Slot is occupied - check if same key
    this.emit(`${probeBodyLabel}:`);
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strcmp(i8* ${keyAtSlot}, i8* ${keyValue})`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i32 ${cmpResult}, 0`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${probeLabel}_next`);

    // Key already exists - update value
    this.emit(`${foundLabel}:`);
    const valElemPtrFound = this.nextTemp();
    this.emit(`${valElemPtrFound} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${slot}`);
    this.emit(`store i8* ${valueValue}, i8** ${valElemPtrFound}`);
    this.emit(`br label %${endLabel}`);

    // Next probe slot
    this.emit(`${probeLabel}_next:`);
    const nextSlot = this.nextTemp();
    this.emit(`${nextSlot} = add i32 ${slot}, 1`);
    const wrappedSlot = this.nextTemp();
    this.emit(`${wrappedSlot} = and i32 ${nextSlot}, ${mask}`);
    this.emit(`store i32 ${wrappedSlot}, i32* ${slotReg}`);
    this.emit(`br label %${probeLabel}`);

    // Empty slot found - insert new entry
    this.emit(`${insertLabel}:`);
    const insertSlot = this.nextTemp();
    this.emit(`${insertSlot} = load i32, i32* ${slotReg}`);
    const keyInsertPtr = this.nextTemp();
    this.emit(`${keyInsertPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${insertSlot}`);
    this.emit(`store i8* ${keyValue}, i8** ${keyInsertPtr}`);
    const valInsertPtr = this.nextTemp();
    this.emit(`${valInsertPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${insertSlot}`);
    this.emit(`store i8* ${valueValue}, i8** ${valInsertPtr}`);

    const newSize = this.nextTemp();
    this.emit(`${newSize} = load i32, i32* ${sizeFieldPtr}`);
    const incSize = this.nextTemp();
    this.emit(`${incSize} = add i32 ${newSize}, 1`);
    this.emit(`store i32 ${incSize}, i32* ${sizeFieldPtr}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${endLabel}:`);

    return mapPtr;
  }

  generateStringMapGet(mapPtr: string, keyToFind: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i8**, i8*** ${keysFieldPtr}`);
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i8**, i8*** ${valuesFieldPtr}`);
    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`);
    const capacity = this.nextTemp();
    this.emit(`${capacity} = load i32, i32* ${capacityFieldPtr}`);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca i8*`);
    this.emit(`store i8* null, i8** ${resultReg}`);

    const hash = this.nextTemp();
    this.emit(`${hash} = call i32 @__string_hash(i8* ${keyToFind})`);
    const mask = this.nextTemp();
    this.emit(`${mask} = sub i32 ${capacity}, 1`);
    const startSlot = this.nextTemp();
    this.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

    const probeLabel = this.nextLabel('strmap_get_probe');
    const probeBodyLabel = this.nextLabel('strmap_get_body');
    const foundLabel = this.nextLabel('strmap_get_found');
    const endLabel = this.nextLabel('strmap_get_end');

    const slotReg = this.nextTemp();
    this.emit(`${slotReg} = alloca i32`);
    this.emit(`store i32 ${startSlot}, i32* ${slotReg}`);
    this.emit(`br label %${probeLabel}`);

    this.emit(`${probeLabel}:`);
    const slot = this.nextTemp();
    this.emit(`${slot} = load i32, i32* ${slotReg}`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
    const keyAtSlot = this.nextTemp();
    this.emit(`${keyAtSlot} = load i8*, i8** ${keyElemPtr}`);
    const isNull = this.nextTemp();
    this.emit(`${isNull} = icmp eq i8* ${keyAtSlot}, null`);
    this.emit(`br i1 ${isNull}, label %${endLabel}, label %${probeBodyLabel}`);

    this.emit(`${probeBodyLabel}:`);
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strcmp(i8* ${keyAtSlot}, i8* ${keyToFind})`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i32 ${cmpResult}, 0`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${probeLabel}_next`);

    this.emit(`${foundLabel}:`);
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${slot}`);
    const foundValue = this.nextTemp();
    this.emit(`${foundValue} = load i8*, i8** ${valueElemPtr}`);
    this.emit(`store i8* ${foundValue}, i8** ${resultReg}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${probeLabel}_next:`);
    const nextSlot = this.nextTemp();
    this.emit(`${nextSlot} = add i32 ${slot}, 1`);
    const wrappedSlot = this.nextTemp();
    this.emit(`${wrappedSlot} = and i32 ${nextSlot}, ${mask}`);
    this.emit(`store i32 ${wrappedSlot}, i32* ${slotReg}`);
    this.emit(`br label %${probeLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load i8*, i8** ${resultReg}`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  generateStringMapHas(mapPtr: string, keyToFind: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i8**, i8*** ${keysFieldPtr}`);
    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`);
    const capacity = this.nextTemp();
    this.emit(`${capacity} = load i32, i32* ${capacityFieldPtr}`);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.emit(`store double 0.0, double* ${resultReg}`);

    const hash = this.nextTemp();
    this.emit(`${hash} = call i32 @__string_hash(i8* ${keyToFind})`);
    const mask = this.nextTemp();
    this.emit(`${mask} = sub i32 ${capacity}, 1`);
    const startSlot = this.nextTemp();
    this.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

    const probeLabel = this.nextLabel('strmap_has_probe');
    const probeBodyLabel = this.nextLabel('strmap_has_body');
    const foundLabel = this.nextLabel('strmap_has_found');
    const endLabel = this.nextLabel('strmap_has_end');

    const slotReg = this.nextTemp();
    this.emit(`${slotReg} = alloca i32`);
    this.emit(`store i32 ${startSlot}, i32* ${slotReg}`);
    this.emit(`br label %${probeLabel}`);

    this.emit(`${probeLabel}:`);
    const slot = this.nextTemp();
    this.emit(`${slot} = load i32, i32* ${slotReg}`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
    const keyAtSlot = this.nextTemp();
    this.emit(`${keyAtSlot} = load i8*, i8** ${keyElemPtr}`);
    const isNull = this.nextTemp();
    this.emit(`${isNull} = icmp eq i8* ${keyAtSlot}, null`);
    this.emit(`br i1 ${isNull}, label %${endLabel}, label %${probeBodyLabel}`);

    this.emit(`${probeBodyLabel}:`);
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strcmp(i8* ${keyAtSlot}, i8* ${keyToFind})`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i32 ${cmpResult}, 0`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${probeLabel}_next`);

    this.emit(`${foundLabel}:`);
    this.emit(`store double 1.0, double* ${resultReg}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${probeLabel}_next:`);
    const nextSlot = this.nextTemp();
    this.emit(`${nextSlot} = add i32 ${slot}, 1`);
    const wrappedSlot = this.nextTemp();
    this.emit(`${wrappedSlot} = and i32 ${nextSlot}, ${mask}`);
    this.emit(`store i32 ${wrappedSlot}, i32* ${slotReg}`);
    this.emit(`br label %${probeLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load double, double* ${resultReg}`);

    return result;
  }

  generateStringMapSize(mapPtr: string): string {
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const size = this.nextTemp();
    this.emit(`${size} = load i32, i32* ${sizeFieldPtr}`);
    return size;
  }

  generateStringMapClear(mapPtr: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`);
    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`);
    const capacity = this.nextTemp();
    this.emit(`${capacity} = load i32, i32* ${capacityFieldPtr}`);

    const capI64 = this.nextTemp();
    this.emit(`${capI64} = sext i32 ${capacity} to i64`);
    const arrSize = this.nextTemp();
    this.emit(`${arrSize} = mul i64 ${capI64}, 8`);

    const newKeysMem = this.nextTemp();
    this.emit(`${newKeysMem} = call i8* @GC_malloc(i64 ${arrSize})`);
    const newKeysPtr = this.nextTemp();
    this.emit(`${newKeysPtr} = bitcast i8* ${newKeysMem} to i8**`);
    this.emit(`store i8** ${newKeysPtr}, i8*** ${keysFieldPtr}`);

    const newValuesMem = this.nextTemp();
    this.emit(`${newValuesMem} = call i8* @GC_malloc(i64 ${arrSize})`);
    const newValuesPtr = this.nextTemp();
    this.emit(`${newValuesPtr} = bitcast i8* ${newValuesMem} to i8**`);
    this.emit(`store i8** ${newValuesPtr}, i8*** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    this.emit(`store i32 0, i32* ${sizeFieldPtr}`);
    return '0.0';
  }

  generateStringMapDelete(mapPtr: string, keyToFind: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i8**, i8*** ${keysFieldPtr}`);
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i8**, i8*** ${valuesFieldPtr}`);
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`);
    const capacity = this.nextTemp();
    this.emit(`${capacity} = load i32, i32* ${capacityFieldPtr}`);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.emit(`store double 0.0, double* ${resultReg}`);

    const hash = this.nextTemp();
    this.emit(`${hash} = call i32 @__string_hash(i8* ${keyToFind})`);
    const mask = this.nextTemp();
    this.emit(`${mask} = sub i32 ${capacity}, 1`);
    const startSlot = this.nextTemp();
    this.emit(`${startSlot} = and i32 ${hash}, ${mask}`);

    const probeLabel = this.nextLabel('strmap_del_probe');
    const probeBodyLabel = this.nextLabel('strmap_del_body');
    const foundLabel = this.nextLabel('strmap_del_found');
    const rehashLabel = this.nextLabel('strmap_del_rehash');
    const rehashBodyLabel = this.nextLabel('strmap_del_rehash_body');
    const rehashInsertLabel = this.nextLabel('strmap_del_rehash_insert');
    const rehashProbeLabel = this.nextLabel('strmap_del_rehash_probe');
    const rehashPlaceLabel = this.nextLabel('strmap_del_rehash_place');
    const endLabel = this.nextLabel('strmap_del_end');

    const slotReg = this.nextTemp();
    this.emit(`${slotReg} = alloca i32`);
    this.emit(`store i32 ${startSlot}, i32* ${slotReg}`);
    this.emit(`br label %${probeLabel}`);

    this.emit(`${probeLabel}:`);
    const slot = this.nextTemp();
    this.emit(`${slot} = load i32, i32* ${slotReg}`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${slot}`);
    const keyAtSlot = this.nextTemp();
    this.emit(`${keyAtSlot} = load i8*, i8** ${keyElemPtr}`);
    const isNull = this.nextTemp();
    this.emit(`${isNull} = icmp eq i8* ${keyAtSlot}, null`);
    this.emit(`br i1 ${isNull}, label %${endLabel}, label %${probeBodyLabel}`);

    this.emit(`${probeBodyLabel}:`);
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strcmp(i8* ${keyAtSlot}, i8* ${keyToFind})`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i32 ${cmpResult}, 0`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${probeLabel}_next`);

    this.emit(`${probeLabel}_next:`);
    const nextSlotDel = this.nextTemp();
    this.emit(`${nextSlotDel} = add i32 ${slot}, 1`);
    const wrappedSlotDel = this.nextTemp();
    this.emit(`${wrappedSlotDel} = and i32 ${nextSlotDel}, ${mask}`);
    this.emit(`store i32 ${wrappedSlotDel}, i32* ${slotReg}`);
    this.emit(`br label %${probeLabel}`);

    // Found - remove entry and backward-shift rehash
    this.emit(`${foundLabel}:`);
    this.emit(`store double 1.0, double* ${resultReg}`);
    const foundSlot = this.nextTemp();
    this.emit(`${foundSlot} = load i32, i32* ${slotReg}`);
    const foundKeyPtr = this.nextTemp();
    this.emit(`${foundKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${foundSlot}`);
    this.emit(`store i8* null, i8** ${foundKeyPtr}`);
    const foundValPtr = this.nextTemp();
    this.emit(`${foundValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${foundSlot}`);
    this.emit(`store i8* null, i8** ${foundValPtr}`);
    const curSize = this.nextTemp();
    this.emit(`${curSize} = load i32, i32* ${sizeFieldPtr}`);
    const decSize = this.nextTemp();
    this.emit(`${decSize} = sub i32 ${curSize}, 1`);
    this.emit(`store i32 ${decSize}, i32* ${sizeFieldPtr}`);

    // Backward-shift rehash: fix up subsequent entries displaced by linear probing
    const rehashIdx = this.nextTemp();
    this.emit(`${rehashIdx} = alloca i32`);
    const nextAfterFound = this.nextTemp();
    this.emit(`${nextAfterFound} = add i32 ${foundSlot}, 1`);
    const wrappedNext = this.nextTemp();
    this.emit(`${wrappedNext} = and i32 ${nextAfterFound}, ${mask}`);
    this.emit(`store i32 ${wrappedNext}, i32* ${rehashIdx}`);
    this.emit(`br label %${rehashLabel}`);

    this.emit(`${rehashLabel}:`);
    const ri = this.nextTemp();
    this.emit(`${ri} = load i32, i32* ${rehashIdx}`);
    const riKeyPtr = this.nextTemp();
    this.emit(`${riKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${ri}`);
    const riKey = this.nextTemp();
    this.emit(`${riKey} = load i8*, i8** ${riKeyPtr}`);
    const riIsNull = this.nextTemp();
    this.emit(`${riIsNull} = icmp eq i8* ${riKey}, null`);
    this.emit(`br i1 ${riIsNull}, label %${endLabel}, label %${rehashBodyLabel}`);

    this.emit(`${rehashBodyLabel}:`);
    const riHash = this.nextTemp();
    this.emit(`${riHash} = call i32 @__string_hash(i8* ${riKey})`);
    const riDesired = this.nextTemp();
    this.emit(`${riDesired} = and i32 ${riHash}, ${mask}`);
    // Remove current entry
    this.emit(`store i8* null, i8** ${riKeyPtr}`);
    const riValPtr = this.nextTemp();
    this.emit(`${riValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${ri}`);
    const riVal = this.nextTemp();
    this.emit(`${riVal} = load i8*, i8** ${riValPtr}`);
    this.emit(`store i8* null, i8** ${riValPtr}`);
    // Re-insert from desired position
    const riSlotReg = this.nextTemp();
    this.emit(`${riSlotReg} = alloca i32`);
    this.emit(`store i32 ${riDesired}, i32* ${riSlotReg}`);
    this.emit(`br label %${rehashProbeLabel}`);

    this.emit(`${rehashProbeLabel}:`);
    const riSlot = this.nextTemp();
    this.emit(`${riSlot} = load i32, i32* ${riSlotReg}`);
    const riSlotKeyPtr = this.nextTemp();
    this.emit(`${riSlotKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${riSlot}`);
    const riSlotKey = this.nextTemp();
    this.emit(`${riSlotKey} = load i8*, i8** ${riSlotKeyPtr}`);
    const riSlotEmpty = this.nextTemp();
    this.emit(`${riSlotEmpty} = icmp eq i8* ${riSlotKey}, null`);
    this.emit(`br i1 ${riSlotEmpty}, label %${rehashPlaceLabel}, label %${rehashProbeLabel}_next`);

    this.emit(`${rehashProbeLabel}_next:`);
    const riNextSlot = this.nextTemp();
    this.emit(`${riNextSlot} = add i32 ${riSlot}, 1`);
    const riWrapped = this.nextTemp();
    this.emit(`${riWrapped} = and i32 ${riNextSlot}, ${mask}`);
    this.emit(`store i32 ${riWrapped}, i32* ${riSlotReg}`);
    this.emit(`br label %${rehashProbeLabel}`);

    this.emit(`${rehashPlaceLabel}:`);
    const placeSlot = this.nextTemp();
    this.emit(`${placeSlot} = load i32, i32* ${riSlotReg}`);
    const placeKeyPtr = this.nextTemp();
    this.emit(`${placeKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${placeSlot}`);
    this.emit(`store i8* ${riKey}, i8** ${placeKeyPtr}`);
    const placeValPtr = this.nextTemp();
    this.emit(`${placeValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${placeSlot}`);
    this.emit(`store i8* ${riVal}, i8** ${placeValPtr}`);

    const riNext = this.nextTemp();
    this.emit(`${riNext} = add i32 ${ri}, 1`);
    const riNextWrapped = this.nextTemp();
    this.emit(`${riNextWrapped} = and i32 ${riNext}, ${mask}`);
    this.emit(`store i32 ${riNextWrapped}, i32* ${rehashIdx}`);
    this.emit(`br label %${rehashLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load double, double* ${resultReg}`);

    return result;
  }

  generateStringMapEntries(mapPtr: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i8**, i8*** ${keysFieldPtr}`);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i8**, i8*** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`);
    const mapCapacity = this.nextTemp();
    this.emit(`${mapCapacity} = load i32, i32* ${capacityFieldPtr}`);

    const arrayMem = this.nextTemp();
    this.emit(`${arrayMem} = call i8* @GC_malloc(i64 24)`);
    const arrayPtr = this.nextTemp();
    this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %Array*`);

    const mapSizeI64 = this.nextTemp();
    this.emit(`${mapSizeI64} = sext i32 ${mapSize} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

    const lenFieldPtr = this.nextTemp();
    this.emit(`${lenFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    this.emit(`store i32 ${mapSize}, i32* ${lenFieldPtr}`);
    const capFieldPtr = this.nextTemp();
    this.emit(`${capFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${mapSize}, i32* ${capFieldPtr}`);
    const dataFieldPtr = this.nextTemp();
    this.emit(`${dataFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const dataCast = this.nextTemp();
    this.emit(`${dataCast} = bitcast i8** ${dataPtr} to double*`);
    this.emit(`store double* ${dataCast}, double** ${dataFieldPtr}`);

    const loopLabel = this.nextLabel('strmap_entries_loop');
    const bodyLabel = this.nextLabel('strmap_entries_body');
    const skipLabel = this.nextLabel('strmap_entries_skip');
    const endLabel = this.nextLabel('strmap_entries_end');

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexReg}`);
    const outIdxReg = this.nextTemp();
    this.emit(`${outIdxReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${outIdxReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${loopLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexReg}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${currentIndex}, ${mapCapacity}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.nextTemp();
    this.emit(`${keyValue} = load i8*, i8** ${keyElemPtr}`);
    const keyIsNull = this.nextTemp();
    this.emit(`${keyIsNull} = icmp eq i8* ${keyValue}, null`);
    this.emit(`br i1 ${keyIsNull}, label %${skipLabel}, label %${bodyLabel}_store`);

    this.emit(`${bodyLabel}_store:`);
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
    const valueValue = this.nextTemp();
    this.emit(`${valueValue} = load i8*, i8** ${valueElemPtr}`);

    const entryMem = this.nextTemp();
    this.emit(`${entryMem} = call i8* @GC_malloc(i64 16)`);
    const entryKvPtr = this.nextTemp();
    this.emit(`${entryKvPtr} = bitcast i8* ${entryMem} to { i8*, i8* }*`);
    const keySlot = this.nextTemp();
    this.emit(`${keySlot} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryKvPtr}, i32 0, i32 0`);
    this.emit(`store i8* ${keyValue}, i8** ${keySlot}`);
    const valueSlot = this.nextTemp();
    this.emit(`${valueSlot} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryKvPtr}, i32 0, i32 1`);
    this.emit(`store i8* ${valueValue}, i8** ${valueSlot}`);

    const outIdx = this.nextTemp();
    this.emit(`${outIdx} = load i32, i32* ${outIdxReg}`);
    const entrySlot = this.nextTemp();
    this.emit(`${entrySlot} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${outIdx}`);
    this.emit(`store i8* ${entryMem}, i8** ${entrySlot}`);
    const nextOut = this.nextTemp();
    this.emit(`${nextOut} = add i32 ${outIdx}, 1`);
    this.emit(`store i32 ${nextOut}, i32* ${outIdxReg}`);
    this.emit(`br label %${skipLabel}`);

    this.emit(`${skipLabel}:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);

    return arrayPtr;
  }

  generateStringMapValues(mapPtr: string): string {
    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i8**, i8*** ${valuesFieldPtr}`);

    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i8**, i8*** ${keysFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`);
    const mapCapacity = this.nextTemp();
    this.emit(`${mapCapacity} = load i32, i32* ${capacityFieldPtr}`);

    const arrayMem = this.nextTemp();
    this.emit(`${arrayMem} = call i8* @GC_malloc(i64 24)`);
    const arrayPtr = this.nextTemp();
    this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %Array*`);

    const mapSizeI64 = this.nextTemp();
    this.emit(`${mapSizeI64} = sext i32 ${mapSize} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

    const lenFieldPtr = this.nextTemp();
    this.emit(`${lenFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    this.emit(`store i32 ${mapSize}, i32* ${lenFieldPtr}`);
    const capFieldPtr = this.nextTemp();
    this.emit(`${capFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${mapSize}, i32* ${capFieldPtr}`);
    const dataFieldPtr = this.nextTemp();
    this.emit(`${dataFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const dataCast = this.nextTemp();
    this.emit(`${dataCast} = bitcast i8** ${dataPtr} to double*`);
    this.emit(`store double* ${dataCast}, double** ${dataFieldPtr}`);

    const loopLabel = this.nextLabel('strmap_values_loop');
    const bodyLabel = this.nextLabel('strmap_values_body');
    const skipLabel = this.nextLabel('strmap_values_skip');
    const endLabel = this.nextLabel('strmap_values_end');

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexReg}`);
    const outIdxReg = this.nextTemp();
    this.emit(`${outIdxReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${outIdxReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${loopLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexReg}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${currentIndex}, ${mapCapacity}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.nextTemp();
    this.emit(`${keyValue} = load i8*, i8** ${keyElemPtr}`);
    const keyIsNull = this.nextTemp();
    this.emit(`${keyIsNull} = icmp eq i8* ${keyValue}, null`);
    this.emit(`br i1 ${keyIsNull}, label %${skipLabel}, label %${bodyLabel}_store`);

    this.emit(`${bodyLabel}_store:`);
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
    const valueValue = this.nextTemp();
    this.emit(`${valueValue} = load i8*, i8** ${valueElemPtr}`);

    const outIdx = this.nextTemp();
    this.emit(`${outIdx} = load i32, i32* ${outIdxReg}`);
    const valueSlot = this.nextTemp();
    this.emit(`${valueSlot} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${outIdx}`);
    this.emit(`store i8* ${valueValue}, i8** ${valueSlot}`);
    const nextOut = this.nextTemp();
    this.emit(`${nextOut} = add i32 ${outIdx}, 1`);
    this.emit(`store i32 ${nextOut}, i32* ${outIdxReg}`);
    this.emit(`br label %${skipLabel}`);

    this.emit(`${skipLabel}:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);

    return arrayPtr;
  }

  generateStringMapKeys(mapPtr: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i8**, i8*** ${keysFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    const capacityFieldPtr = this.nextTemp();
    this.emit(`${capacityFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`);
    const mapCapacity = this.nextTemp();
    this.emit(`${mapCapacity} = load i32, i32* ${capacityFieldPtr}`);

    const arrayMem = this.nextTemp();
    this.emit(`${arrayMem} = call i8* @GC_malloc(i64 24)`);
    const arrayPtr = this.nextTemp();
    this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %StringArray*`);

    const mapSizeI64 = this.nextTemp();
    this.emit(`${mapSizeI64} = sext i32 ${mapSize} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${mapSizeI64}, 8`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    this.emit(`store i8** ${dataPtr}, i8*** ${dataPtrField}`);
    const lenFieldPtr = this.nextTemp();
    this.emit(`${lenFieldPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${mapSize}, i32* ${lenFieldPtr}`);
    const capFieldPtr = this.nextTemp();
    this.emit(`${capFieldPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${mapSize}, i32* ${capFieldPtr}`);

    const loopLabel = this.nextLabel('strmap_keys_loop');
    const bodyLabel = this.nextLabel('strmap_keys_body');
    const skipLabel = this.nextLabel('strmap_keys_skip');
    const endLabel = this.nextLabel('strmap_keys_end');

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexReg}`);
    const outIdxReg = this.nextTemp();
    this.emit(`${outIdxReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${outIdxReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${loopLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexReg}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${currentIndex}, ${mapCapacity}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyVal = this.nextTemp();
    this.emit(`${keyVal} = load i8*, i8** ${keyElemPtr}`);
    const keyIsNull = this.nextTemp();
    this.emit(`${keyIsNull} = icmp eq i8* ${keyVal}, null`);
    this.emit(`br i1 ${keyIsNull}, label %${skipLabel}, label %${bodyLabel}_store`);

    this.emit(`${bodyLabel}_store:`);
    const outIdx = this.nextTemp();
    this.emit(`${outIdx} = load i32, i32* ${outIdxReg}`);
    const destElemPtr = this.nextTemp();
    this.emit(`${destElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${outIdx}`);
    this.emit(`store i8* ${keyVal}, i8** ${destElemPtr}`);
    const nextOut = this.nextTemp();
    this.emit(`${nextOut} = add i32 ${outIdx}, 1`);
    this.emit(`store i32 ${nextOut}, i32* ${outIdxReg}`);
    this.emit(`br label %${skipLabel}`);

    this.emit(`${skipLabel}:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);

    this.ctx.setVariableType(arrayPtr, '%StringArray*');
    return arrayPtr;
  }
}

export class PointerMapGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private nextTemp(): string { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string): string { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }

  generatePointerMapGet(mapPtr: string, keyToFind: string, valueType: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i8**, i8*** ${keysFieldPtr}`);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i8**, i8*** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca i8*`);
    this.emit(`store i8* null, i8** ${resultReg}`);

    const loopLabel = this.nextLabel('ptrmap_get_loop');
    const bodyLabel = this.nextLabel('ptrmap_get_body');
    const foundLabel = this.nextLabel('ptrmap_get_found');
    const endLabel = this.nextLabel('ptrmap_get_end');

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
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyValue = this.nextTemp();
    this.emit(`${keyValue} = load i8*, i8** ${keyElemPtr}`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i8* ${keyValue}, ${keyToFind}`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${loopLabel}_next`);

    this.emit(`${foundLabel}:`);
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
    const foundValue = this.nextTemp();
    this.emit(`${foundValue} = load i8*, i8** ${valueElemPtr}`);
    this.emit(`store i8* ${foundValue}, i8** ${resultReg}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${loopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load i8*, i8** ${resultReg}`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  generatePointerMapSet(mapPtr: string, keyValue: string, valueValue: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i8**, i8*** ${keysFieldPtr}`);

    const valuesFieldPtr = this.nextTemp();
    this.emit(`${valuesFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`);
    const valuesPtr = this.nextTemp();
    this.emit(`${valuesPtr} = load i8**, i8*** ${valuesFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const currentSize = this.nextTemp();
    this.emit(`${currentSize} = load i32, i32* ${sizeFieldPtr}`);

    const searchLoopLabel = this.nextLabel('ptrmap_set_search');
    const searchBodyLabel = this.nextLabel('ptrmap_set_body');
    const foundLabel = this.nextLabel('ptrmap_set_found');
    const notFoundLabel = this.nextLabel('ptrmap_set_notfound');
    const insertLabel = this.nextLabel('ptrmap_set_insert');
    const endLabel = this.nextLabel('ptrmap_set_end');

    const indexReg = this.nextTemp();
    this.emit(`${indexReg} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexReg}`);
    this.emit(`br label %${searchLoopLabel}`);

    this.emit(`${searchLoopLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexReg}`);
    const searchCond = this.nextTemp();
    this.emit(`${searchCond} = icmp slt i32 ${currentIndex}, ${currentSize}`);
    this.emit(`br i1 ${searchCond}, label %${searchBodyLabel}, label %${notFoundLabel}`);

    this.emit(`${searchBodyLabel}:`);
    const keyElemPtrSearch = this.nextTemp();
    this.emit(`${keyElemPtrSearch} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentIndex}`);
    const keyAtIndex = this.nextTemp();
    this.emit(`${keyAtIndex} = load i8*, i8** ${keyElemPtrSearch}`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i8* ${keyAtIndex}, ${keyValue}`);
    this.emit(`br i1 ${keyMatch}, label %${foundLabel}, label %${searchLoopLabel}_next`);

    this.emit(`${searchLoopLabel}_next:`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${searchLoopLabel}`);

    this.emit(`${foundLabel}:`);
    const foundIdx = this.nextTemp();
    this.emit(`${foundIdx} = load i32, i32* ${indexReg}`);
    const valueElemPtrFound = this.nextTemp();
    this.emit(`${valueElemPtrFound} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${foundIdx}`);
    this.emit(`store i8* ${valueValue}, i8** ${valueElemPtrFound}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${notFoundLabel}:`);
    this.emit(`br label %${insertLabel}`);

    this.emit(`${insertLabel}:`);
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentSize}`);
    this.emit(`store i8* ${keyValue}, i8** ${keyElemPtr}`);

    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentSize}`);
    this.emit(`store i8* ${valueValue}, i8** ${valueElemPtr}`);

    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.emit(`store i32 ${newSize}, i32* ${sizeFieldPtr}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${endLabel}:`);

    return mapPtr;
  }

  generatePointerMapClear(mapPtr: string): string {
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    this.emit(`store i32 0, i32* ${sizeFieldPtr}`);
    return '0.0';
  }
}
