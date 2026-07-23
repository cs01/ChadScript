// Reading and writing `T | null` / `T | undefined` fields and variables. Three distinct bugs
// lived here: a null check on a NARROWED variable ICEd, a present value assigned into an optional
// field was stored unboxed (segfault once read at another depth), and a narrowed optional field
// was read as the value itself rather than unwrapped (a box pointer printed as a float).

interface Node2 {
  label: string;
  next: Node2 | null;
  extra: number | undefined;
}

// Narrowing a variable that tsc proves non-null, then null-checking it anyway.
interface Box {
  value: number;
}
function mk(n: number): Box {
  return { value: n };
}
let b: Box | null = null;
b = mk(1);
b = mk(2);
console.log(b === null ? -1 : b.value);

// Assigning a present value into an optional FIELD must box it.
const a: Node2 = { label: "a", next: null, extra: undefined };
const c: Node2 = { label: "c", next: null, extra: 7 };
a.next = c;
const viaField = a.next;
console.log(viaField === null ? "none" : viaField.label);
console.log(a.next === null ? "none" : a.next.label);

// Chained reads through narrowed optional fields.
const first: Node2 = { label: "1", next: { label: "2", next: null, extra: undefined }, extra: 1 };
const second = first.next;
console.log(second === null ? "none" : second.label);
console.log(first.extra ?? -1, second === null ? -1 : (second.extra ?? -1));

// Reassigning an optional field back to null.
a.next = null;
console.log(a.next === null ? "cleared" : "still set");

// Optional numbers round-trip through a field without becoming a pointer.
c.extra = 42;
console.log(c.extra ?? -1);
