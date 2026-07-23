// @expect-reject: CS1226
// A cycle has no dependency order, so module initialization has no correct sequence.
import { A } from "./a.ts";
console.log(A);
