// Validator diagnostic codes. CS1000 is the generic default-deny rejection; CS12xx are
// tailored rejections for constructs that are permanently or currently out of the subset,
// each carrying a specific rewrite suggestion. Keeping them in one table makes the
// rejection-fixture suite's `@expect-reject: CSxxxx` annotations easy to keep honest.

export const CODE = {
  // Generic: a node kind / type the allowlist has not admitted yet.
  NOT_IN_SUBSET: "CS1000",

  // Tailored, permanent rejections (with rewrites).
  ANY_TYPE: "CS1201",
  ENUM: "CS1202",
  EQEQ: "CS1203", // == / != (use === / !==)
  NON_NULL_ASSERTION: "CS1204", // x!  (use an explicit check)
  AS_ANY: "CS1205", // as any / as unknown escape
  DELETE: "CS1206",
  INDEX_SIGNATURE: "CS1207", // [k: string]: T  (use Map)
  DECORATOR: "CS1208",
  NAMESPACE: "CS1209", // namespace / module block
  WITH: "CS1210",
  EVAL_OR_FUNCTION_CTOR: "CS1211", // eval / new Function
  VAR: "CS1212", // `var` (use let/const)
  REGEX: "CS1213", // regex literals / RegExp — a later phase, not yet in the subset
  JSON_API: "CS1214", // JSON.stringify / JSON.parse — a later phase
  DATE_API: "CS1215", // Date — a later phase
} as const;

export type Code = (typeof CODE)[keyof typeof CODE];
