import * as path from "path";

const FIRST_DEBUG_METADATA_ID = 8;

export class DebugInfoEmitter {
  private nextId: number = FIRST_DEBUG_METADATA_ID;
  private nodeMap: Map<number, string> = new Map();
  private fileId: number;
  private compileUnitId: number;
  private subroutineTypeId: number;
  private subprogramIds: Map<string, number> = new Map();
  private locationCache: Map<string, number> = new Map();

  constructor(sourceFilePath: string) {
    this.nodeMap = new Map();
    this.subprogramIds = new Map();
    this.locationCache = new Map();

    const filename = path.basename(sourceFilePath);
    const directory = path.dirname(path.resolve(sourceFilePath));

    this.fileId = this.alloc();
    this.nodeMap.set(
      this.fileId,
      `!${this.fileId} = !DIFile(filename: "${this.escape(filename)}", directory: "${this.escape(directory)}")`,
    );

    this.compileUnitId = this.alloc();

    this.subroutineTypeId = this.alloc();
    this.nodeMap.set(
      this.subroutineTypeId,
      `!${this.subroutineTypeId} = !DISubroutineType(types: !{})`,
    );
  }

  createSubprogram(funcName: string, line: number): number {
    const existing = this.subprogramIds.get(funcName);
    if (existing !== undefined) return existing;

    const id = this.alloc();
    this.nodeMap.set(
      id,
      `!${id} = distinct !DISubprogram(name: "${this.escape(funcName)}", ` +
        `scope: !${this.fileId}, file: !${this.fileId}, line: ${line}, ` +
        `type: !${this.subroutineTypeId}, isLocal: false, isDefinition: true, ` +
        `scopeLine: ${line}, unit: !${this.compileUnitId})`,
    );
    this.subprogramIds.set(funcName, id);
    return id;
  }

  createLocation(line: number, column: number, scopeId: number): number {
    const key = `${line}:${column}:${scopeId}`;
    const existing = this.locationCache.get(key);
    if (existing !== undefined) return existing;

    const id = this.alloc();
    this.nodeMap.set(
      id,
      `!${id} = !DILocation(line: ${line}, column: ${column}, scope: !${scopeId})`,
    );
    this.locationCache.set(key, id);
    return id;
  }

  finalize(): void {
    const dwarfVerId = this.alloc();
    this.nodeMap.set(dwarfVerId, `!${dwarfVerId} = !{i32 2, !"Dwarf Version", i32 4}`);

    const debugInfoVerId = this.alloc();
    this.nodeMap.set(debugInfoVerId, `!${debugInfoVerId} = !{i32 2, !"Debug Info Version", i32 3}`);

    this.nodeMap.set(
      this.compileUnitId,
      `!${this.compileUnitId} = distinct !DICompileUnit(language: DW_LANG_C99, ` +
        `file: !${this.fileId}, producer: "ChadScript", isOptimized: false, ` +
        `runtimeVersion: 0, emissionKind: FullDebug)`,
    );

    this._dwarfVerId = dwarfVerId;
    this._debugInfoVerId = debugInfoVerId;
  }

  private _dwarfVerId: number = -1;
  private _debugInfoVerId: number = -1;

  getNamedMetadata(): string {
    let result = "";
    result += `!llvm.dbg.cu = !{!${this.compileUnitId}}\n`;
    result += `!llvm.module.flags = !{!${this._dwarfVerId}, !${this._debugInfoVerId}}\n`;
    return result;
  }

  getNumberedMetadata(): string {
    let result = "";
    for (let id = FIRST_DEBUG_METADATA_ID; id < this.nextId; id++) {
      const node = this.nodeMap.get(id);
      if (node) {
        result += node + "\n";
      }
    }
    return result;
  }

  private alloc(): number {
    const id = this.nextId;
    this.nextId++;
    return id;
  }

  private escape(s: string): string {
    let result = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') {
        result += '\\"';
      } else if (c === "\\") {
        result += "\\\\";
      } else {
        result += c;
      }
    }
    return result;
  }
}
