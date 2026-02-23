// Shared context interface for array submodules.
// All array codegen functions accept IGeneratorContext directly (same as string/ submodules).
// This file re-exports IGeneratorContext so array submodules import from a single location.

export type { IGeneratorContext } from "../../../infrastructure/generator-context.js";
