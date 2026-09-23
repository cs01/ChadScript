// A `../` specifier from a subdirectory reaches back to a sibling of the entry.
import { twice } from "../math.js";

export function upward(): number {
  return twice(10);
}
