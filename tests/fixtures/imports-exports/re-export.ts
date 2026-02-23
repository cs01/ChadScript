// Tests re-export: imports from barrel file that re-exports from helper
import { getGreeting } from "./re-export-barrel.js";

console.log(getGreeting());
