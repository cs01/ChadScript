// @expect-reject: CS0001
// Importing a type without `type` keeps the import at runtime (verbatimModuleSyntax), where Node
// fails because the module exports no such value. tsc rejects it, so the compiler does too.
import { Shape } from "./types";

const s: Shape = { w: 1 };
console.log(s.w);
