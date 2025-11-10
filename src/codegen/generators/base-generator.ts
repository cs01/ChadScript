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

  // Variable tracking
  public variables: Map<string, string> = new Map(); // i32 variables
  public stringVariables: Map<string, string> = new Map(); // i8* variables
  public arrayVariables: Map<string, string> = new Map(); // %Array variables
  public objectVariables: Map<string, { ptr: string; keys: string[] }> = new Map();
  public mapVariables: Map<string, string> = new Map(); // %Map variables
  public setVariables: Map<string, string> = new Map(); // %Set variables
  public classInstanceVariables: Map<string, { ptr: string; className: string }> = new Map(); // i32* class instances
  public regexVariables: Map<string, string> = new Map(); // i8* regex pointers
  public thisPointer: string | null = null; // Current 'this' pointer (i32*)

  constructor() {}

  // Reset state for new function generation
  reset() {
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.output = [];
    this.variables = new Map();
    this.stringVariables = new Map();
    this.arrayVariables = new Map();
    this.objectVariables = new Map();
    this.mapVariables = new Map();
    this.setVariables = new Map();
    this.classInstanceVariables = new Map();
    this.regexVariables = new Map();
    this.thisPointer = null;
  }

  // Helper to get next temp register (can be overridden)
  nextTemp(): string {
    return `%${this.tempCounter++}`;
  }

  // Helper to get next label (can be overridden)
  nextLabel(prefix: string): string {
    return `${prefix}${this.labelCounter++}`;
  }

  // Helper to get next string constant number (can be overridden)
  nextString(): string {
    return `@.str.${this.stringCounter++}`;
  }

  // Add instruction to output
  emit(instruction: string) {
    this.output.push(instruction);
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
