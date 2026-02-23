// Test that export default works with classes
// Note: renaming default imports (import Foo from './bar' where bar exports Bar)
// is not yet supported by the native compiler
import Greeter from "./greeter.js";

const g = new Greeter("TEST_PASSED");
console.log(g.greet());
