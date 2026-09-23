// `export default <expression>` has no declaration of its own: it is a module-level constant
// evaluated when this module initializes.
const base = 20;
export default base + 1;
