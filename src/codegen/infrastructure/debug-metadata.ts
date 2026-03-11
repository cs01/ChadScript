export class DebugMetadataBuilder {
  private dbgNextId: number = 8;
  private dbgNodeKeys: number[] = [];
  private dbgNodeValues: string[] = [];
  private dbgFileId: number = -1;
  private dbgCompileUnitId: number = -1;
  private dbgSubroutineTypeId: number = -1;
  private dbgSubprogramNames: string[] = [];
  private dbgSubprogramIds: number[] = [];
  private dbgLocationKeys: string[] = [];
  private dbgLocationIds: number[] = [];
  private dbgDwarfVerId: number = -1;
  private dbgDebugInfoVerId: number = -1;

  private dbgAlloc(): number {
    const id = this.dbgNextId;
    this.dbgNextId = this.dbgNextId + 1;
    return id;
  }

  private dbgSetNode(id: number, value: string): void {
    this.dbgNodeKeys.push(id);
    this.dbgNodeValues.push(value);
  }

  private dbgEscape(s: string): string {
    let result = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') {
        result = result + '\\"';
      } else if (c === "\\") {
        result = result + "\\\\";
      } else {
        result = result + c;
      }
    }
    return result;
  }

  init(sourceFilePath: string): void {
    let lastSlash: number = -1;
    for (let i = 0; i < sourceFilePath.length; i++) {
      if (sourceFilePath.charAt(i) === "/") {
        lastSlash = i;
      }
    }
    let filename = sourceFilePath;
    let directory = ".";
    if (lastSlash >= 0) {
      filename = sourceFilePath.substring(lastSlash + 1);
      directory = sourceFilePath.substring(0, lastSlash);
    }

    this.dbgFileId = this.dbgAlloc();
    this.dbgSetNode(
      this.dbgFileId,
      "!" +
        String(this.dbgFileId) +
        ' = !DIFile(filename: "' +
        this.dbgEscape(filename) +
        '", directory: "' +
        this.dbgEscape(directory) +
        '")',
    );

    this.dbgCompileUnitId = this.dbgAlloc();

    this.dbgSubroutineTypeId = this.dbgAlloc();
    this.dbgSetNode(
      this.dbgSubroutineTypeId,
      "!" + String(this.dbgSubroutineTypeId) + " = !DISubroutineType(types: !{})",
    );
  }

  createSubprogram(name: string, line: number): number {
    for (let i = 0; i < this.dbgSubprogramNames.length; i++) {
      if (this.dbgSubprogramNames[i] === name) return this.dbgSubprogramIds[i];
    }
    const id = this.dbgAlloc();
    this.dbgSetNode(
      id,
      "!" +
        String(id) +
        ' = distinct !DISubprogram(name: "' +
        this.dbgEscape(name) +
        '", ' +
        "scope: !" +
        String(this.dbgFileId) +
        ", file: !" +
        String(this.dbgFileId) +
        ", line: " +
        String(line) +
        ", " +
        "type: !" +
        String(this.dbgSubroutineTypeId) +
        ", isLocal: false, isDefinition: true, " +
        "scopeLine: " +
        String(line) +
        ", unit: !" +
        String(this.dbgCompileUnitId) +
        ")",
    );
    this.dbgSubprogramNames.push(name);
    this.dbgSubprogramIds.push(id);
    return id;
  }

  createLocation(line: number, column: number, scopeId: number): number {
    const key = String(line) + ":" + String(column) + ":" + String(scopeId);
    for (let i = 0; i < this.dbgLocationKeys.length; i++) {
      if (this.dbgLocationKeys[i] === key) return this.dbgLocationIds[i];
    }
    const id = this.dbgAlloc();
    this.dbgSetNode(
      id,
      "!" +
        String(id) +
        " = !DILocation(line: " +
        String(line) +
        ", column: " +
        String(column) +
        ", scope: !" +
        String(scopeId) +
        ")",
    );
    this.dbgLocationKeys.push(key);
    this.dbgLocationIds.push(id);
    return id;
  }

  finalize(): void {
    this.dbgDwarfVerId = this.dbgAlloc();
    this.dbgSetNode(
      this.dbgDwarfVerId,
      "!" + String(this.dbgDwarfVerId) + ' = !{i32 2, !"Dwarf Version", i32 4}',
    );

    this.dbgDebugInfoVerId = this.dbgAlloc();
    this.dbgSetNode(
      this.dbgDebugInfoVerId,
      "!" + String(this.dbgDebugInfoVerId) + ' = !{i32 2, !"Debug Info Version", i32 3}',
    );

    this.dbgSetNode(
      this.dbgCompileUnitId,
      "!" +
        String(this.dbgCompileUnitId) +
        " = distinct !DICompileUnit(language: DW_LANG_C99, " +
        "file: !" +
        String(this.dbgFileId) +
        ', producer: "ChadScript", isOptimized: false, ' +
        "runtimeVersion: 0, emissionKind: FullDebug)",
    );
  }

  getNumberedMetadata(): string {
    let result = "";
    for (let id = 8; id < this.dbgNextId; id++) {
      for (let i = 0; i < this.dbgNodeKeys.length; i++) {
        if (this.dbgNodeKeys[i] === id) {
          result = result + this.dbgNodeValues[i] + "\n";
          break;
        }
      }
    }
    return result;
  }

  getNamedMetadata(): string {
    let result = "";
    result = result + "!llvm.dbg.cu = !{!" + String(this.dbgCompileUnitId) + "}\n";
    result =
      result +
      "!llvm.module.flags = !{!" +
      String(this.dbgDwarfVerId) +
      ", !" +
      String(this.dbgDebugInfoVerId) +
      "}\n";
    return result;
  }

  reset(): void {
    this.dbgNextId = 8;
    this.dbgNodeKeys = [];
    this.dbgNodeValues = [];
    this.dbgFileId = -1;
    this.dbgCompileUnitId = -1;
    this.dbgSubroutineTypeId = -1;
    this.dbgSubprogramNames = [];
    this.dbgSubprogramIds = [];
    this.dbgLocationKeys = [];
    this.dbgLocationIds = [];
    this.dbgDwarfVerId = -1;
    this.dbgDebugInfoVerId = -1;
  }
}
