import { Expression } from '../../ast/types.js';

// ============================================
// BASE GENERATOR - Shared state and utilities
// ============================================

export class BaseGenerator {
  public tempCounter: number = 0;
  public labelCounter: number = 0;
  public stringCounter: number = 0;
  public output: string[] = [];
  public globalStrings: string[] = [];
  public currentLabel: string = 'entry'; // Track current basic block label

  // Variable tracking
  public variables: Map<string, string> = new Map(); // Variable name -> alloca register
  public variableTypes: Map<string, string> = new Map(); // Variable name -> LLVM type (e.g., 'i32', 'i8*', '%Array*')
  public stringVariables: Map<string, string> = new Map(); // i8* variables (deprecated - use variableTypes)
  public arrayVariables: Map<string, string> = new Map(); // %Array variables (deprecated - use variableTypes)
  public stringArrayVariables: Map<string, string> = new Map(); // %StringArray variables (deprecated - use variableTypes)
  public objectVariables: Map<string, { ptr: string; keys: string[]; types: string[] }> = new Map();
  public mapVariables: Map<string, string> = new Map(); // %Map variables
  public setVariables: Map<string, string> = new Map(); // %Set variables
  public classInstanceVariables: Map<string, { ptr: string; className: string }> = new Map(); // i32* class instances
  public regexVariables: Map<string, string> = new Map(); // i8* regex pointers
  public jsonObjectVariables: Map<string, string> = new Map(); // i8* cJSON object pointers
  public processArgvVariables: Set<string> = new Set(); // i8** process.argv pointers
  public thisPointer: string | null = null; // Current 'this' pointer (i32*)
  public currentClassName: string | null = null; // Current class name (for super resolution)
  public expectedArrayElementType: 'string' | 'number' | 'boolean' | null = null; // Expected array element type for context-aware generation
  public currentFunctionReturnType: string = 'i32'; // Current function/method return type for return statements

  constructor() {}

  // Reset state for new function generation
  reset() {
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.currentLabel = 'entry';
    this.output = [];
    this.variables = new Map();
    this.variableTypes = new Map();  // CRITICAL: Clear type tracking!
    this.stringVariables = new Map();
    this.arrayVariables = new Map();
    this.stringArrayVariables = new Map();
    this.objectVariables = new Map();
    this.mapVariables = new Map();
    this.setVariables = new Map();
    this.classInstanceVariables = new Map();
    this.regexVariables = new Map();
    this.jsonObjectVariables = new Map();
    this.processArgvVariables = new Set();
    this.thisPointer = null;
    this.currentClassName = null;
    this.currentFunctionReturnType = 'i32';
  }

  // Helper to get next temp register (can be overridden)
  nextTemp(): string {
    return `%${this.tempCounter++}`;
  }

  // Helper to get next label (can be overridden)
  nextLabel(prefix: string): string {
    const label = `${prefix}${this.labelCounter++}`;
    return label;
  }

  // Get the current label (basic block we're in)
  getCurrentLabel(): string {
    return this.currentLabel;
  }

  // Set the current label (call when emitting a new label)
  setCurrentLabel(label: string) {
    this.currentLabel = label;
  }

  // Helper to get next string constant number (can be overridden)
  nextString(): string {
    return `@.str.${this.stringCounter++}`;
  }

  // Add instruction to output
  emit(instruction: string) {
    this.output.push(instruction);
    // If this is a label definition, update current label
    if (instruction.trim().endsWith(':')) {
      const label = instruction.trim().slice(0, -1);
      this.currentLabel = label;
    }
  }

  // Get all output
  getOutput(): string[] {
    return this.output;
  }

  // Get global strings
  getGlobalStrings(): string[] {
    return this.globalStrings;
  }
}
