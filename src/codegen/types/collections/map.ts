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
  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private getDoubleSize() { return 8; } // sizeof(double) = 8 bytes

  generateMapLiteral(expr: Expression, params: string[]): string {
    const mapExpr = expr as { type: string; entries: MapEntry[] };
    if (mapExpr.type !== 'map') {
      throw new Error('Expected map literal');
    }

    // Allocate Map struct on stack
    const mapPtr = this.nextTemp();
    this.emit(`${mapPtr} = alloca %Map`);

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

    return mapPtr;
  }

  generateMapSet(expr: MethodCallNode, params: string[]): string {
    // map.set(key, value)
    if (expr.args.length !== 2) {
      throw new Error('Map.set() requires exactly 2 arguments');
    }

    // Get map pointer
    const mapPtr = this.ctx.generateExpression(expr.object, params);

    // Generate key and value
    const keyValue = this.ctx.generateExpression(expr.args[0], params);
    const valueValue = this.ctx.generateExpression(expr.args[1], params);

    // Load current arrays and size
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

    // For simplicity, assume we're adding a new entry (not updating)
    // Store key at index = currentSize
    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds double, double* ${keysPtr}, i32 ${currentSize}`);
    this.emit(`store double ${keyValue}, double* ${keyElemPtr}`);

    // Store value at index = currentSize
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds double, double* ${valuesPtr}, i32 ${currentSize}`);
    this.emit(`store double ${valueValue}, double* ${valueElemPtr}`);

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

  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
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

    const initialCapacity = 4;
    const ptrSize = this.getPtrSize();

    const keysCapI64 = this.nextTemp();
    this.emit(`${keysCapI64} = zext i32 ${initialCapacity} to i64`);
    const keysSize = this.nextTemp();
    this.emit(`${keysSize} = mul i64 ${keysCapI64}, ${ptrSize}`);
    const keysMem = this.nextTemp();
    this.emit(`${keysMem} = call i8* @GC_malloc(i64 ${keysSize})`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = bitcast i8* ${keysMem} to i8**`);

    const valuesCapI64 = this.nextTemp();
    this.emit(`${valuesCapI64} = zext i32 ${initialCapacity} to i64`);
    const valuesSize = this.nextTemp();
    this.emit(`${valuesSize} = mul i64 ${valuesCapI64}, ${ptrSize}`);
    const valuesMem = this.nextTemp();
    this.emit(`${valuesMem} = call i8* @GC_malloc(i64 ${valuesSize})`);
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

    return mapPtr;
  }

  generateStringMapSet(mapPtr: string, keyValue: string, valueValue: string): string {
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

    const keyElemPtr = this.nextTemp();
    this.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${currentSize}`);
    this.emit(`store i8* ${keyValue}, i8** ${keyElemPtr}`);

    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentSize}`);
    this.emit(`store i8* ${valueValue}, i8** ${valueElemPtr}`);

    const newSize = this.nextTemp();
    this.emit(`${newSize} = add i32 ${currentSize}, 1`);
    this.emit(`store i32 ${newSize}, i32* ${sizeFieldPtr}`);

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

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca i8*`);
    this.emit(`store i8* null, i8** ${resultReg}`);

    const loopLabel = this.nextLabel('strmap_get_loop');
    const bodyLabel = this.nextLabel('strmap_get_body');
    const foundLabel = this.nextLabel('strmap_get_found');
    const endLabel = this.nextLabel('strmap_get_end');

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
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strcmp(i8* ${keyValue}, i8* ${keyToFind})`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i32 ${cmpResult}, 0`);
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

  generateStringMapHas(mapPtr: string, keyToFind: string): string {
    const keysFieldPtr = this.nextTemp();
    this.emit(`${keysFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
    const keysPtr = this.nextTemp();
    this.emit(`${keysPtr} = load i8**, i8*** ${keysFieldPtr}`);

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.emit(`store double 0.0, double* ${resultReg}`);

    const loopLabel = this.nextLabel('strmap_has_loop');
    const bodyLabel = this.nextLabel('strmap_has_body');
    const foundLabel = this.nextLabel('strmap_has_found');
    const endLabel = this.nextLabel('strmap_has_end');

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
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strcmp(i8* ${keyValue}, i8* ${keyToFind})`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i32 ${cmpResult}, 0`);
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

  generateStringMapSize(mapPtr: string): string {
    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const size = this.nextTemp();
    this.emit(`${size} = load i32, i32* ${sizeFieldPtr}`);
    return size;
  }

  generateStringMapClear(mapPtr: string): string {
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
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = alloca double`);
    this.emit(`store double 0.0, double* ${resultReg}`);

    const loopLabel = this.nextLabel('strmap_del_loop');
    const bodyLabel = this.nextLabel('strmap_del_body');
    const foundLabel = this.nextLabel('strmap_del_found');
    const shiftLabel = this.nextLabel('strmap_del_shift');
    const shiftBodyLabel = this.nextLabel('strmap_del_shift_body');
    const endLabel = this.nextLabel('strmap_del_end');

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
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strcmp(i8* ${keyValue}, i8* ${keyToFind})`);
    const keyMatch = this.nextTemp();
    this.emit(`${keyMatch} = icmp eq i32 ${cmpResult}, 0`);
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
    this.emit(`${nextKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${nextI}`);
    const nextKey = this.nextTemp();
    this.emit(`${nextKey} = load i8*, i8** ${nextKeyPtr}`);
    const currKeyPtr = this.nextTemp();
    this.emit(`${currKeyPtr} = getelementptr inbounds i8*, i8** ${keysPtr}, i32 ${shiftI}`);
    this.emit(`store i8* ${nextKey}, i8** ${currKeyPtr}`);
    const nextValPtr = this.nextTemp();
    this.emit(`${nextValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${nextI}`);
    const nextVal = this.nextTemp();
    this.emit(`${nextVal} = load i8*, i8** ${nextValPtr}`);
    const currValPtr = this.nextTemp();
    this.emit(`${currValPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${shiftI}`);
    this.emit(`store i8* ${nextVal}, i8** ${currValPtr}`);
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
    const endLabel = this.nextLabel('strmap_entries_end');

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

    const entrySlot = this.nextTemp();
    this.emit(`${entrySlot} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentIndex}`);
    this.emit(`store i8* ${entryMem}, i8** ${entrySlot}`);

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

    const sizeFieldPtr = this.nextTemp();
    this.emit(`${sizeFieldPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
    const mapSize = this.nextTemp();
    this.emit(`${mapSize} = load i32, i32* ${sizeFieldPtr}`);

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
    const endLabel = this.nextLabel('strmap_values_end');

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
    const valueElemPtr = this.nextTemp();
    this.emit(`${valueElemPtr} = getelementptr inbounds i8*, i8** ${valuesPtr}, i32 ${currentIndex}`);
    const valueValue = this.nextTemp();
    this.emit(`${valueValue} = load i8*, i8** ${valueElemPtr}`);

    const valueSlot = this.nextTemp();
    this.emit(`${valueSlot} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentIndex}`);
    this.emit(`store i8* ${valueValue}, i8** ${valueSlot}`);

    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${currentIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexReg}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${endLabel}:`);

    return arrayPtr;
  }
}
