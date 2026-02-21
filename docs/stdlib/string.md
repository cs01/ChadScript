# String Methods

String values in ChadScript are null-terminated C strings (`i8*`), garbage collected via Boehm GC.

## Properties

### `str.length`

```typescript
const len = "hello".length;    // 5
```

## Methods

### Searching

```typescript
str.indexOf(sub)            // number — index of first occurrence, -1 if not found
str.includes(sub)           // boolean
str.startsWith(prefix)      // boolean
str.endsWith(suffix)        // boolean
```

### Extracting

```typescript
str.charAt(i)               // string — character at index
str.charCodeAt(i)           // number — char code at index
str.slice(start, end?)      // string — substring by indices
str.substr(start, len?)     // string — substring by start + length
str.substring(start, end)   // string — substring between two indices
str[i]                      // number — char code at index (bracket access)
```

### Transforming

```typescript
str.trim()                  // string — remove leading/trailing whitespace
str.trimStart()             // string — remove leading whitespace
str.trimEnd()               // string — remove trailing whitespace
str.toUpperCase()           // string
str.toLowerCase()           // string
str.padStart(len, pad)      // string — pad start to reach length
str.padEnd(len, pad)        // string — pad end to reach length
str.repeat(count)           // string — repeat n times
str.concat(other)           // string — concatenate
```

### Splitting & Replacing

```typescript
str.split(delimiter)        // string[] — split into array
str.replace(search, repl)   // string — replace first occurrence
str.replaceAll(search, repl) // string — replace all occurrences
```

## Example

```typescript
const msg = "  Hello, World!  ";
const trimmed = msg.trim();
console.log(trimmed);                    // "Hello, World!"

const parts = trimmed.split(", ");
console.log(parts.length);              // 2

const upper = trimmed.toUpperCase();
console.log(upper);                     // "HELLO, WORLD!"

if (trimmed.startsWith("Hello")) {
  console.log("starts with Hello");
}

const padded = "42".padStart(5, "0");   // "00042"
const right = "hi".padEnd(10, ".");     // "hi........"
```

## Native Implementation

All string methods are inlined as LLVM IR at the call site — they operate directly on `i8*` C strings using `strlen`, `strstr`, `memcpy`, etc. New strings are allocated with `GC_malloc_atomic`.
