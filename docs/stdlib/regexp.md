# RegExp

Regular expression support. Patterns compile to native regex matching.

## Creating Patterns

```typescript
const re = /hello/i;                    // regex literal
const re2 = new RegExp("hello", "i");   // constructor
```

Supported flags: `i` (case-insensitive), `m` (multiline).

## Methods

### `re.test(str)`

Test if the pattern matches a string.

```typescript
const re = /^hello/i;
re.test("Hello World");    // true
re.test("World Hello");    // false
```

### `re.exec(str)`

Execute a match and return capture groups.

```typescript
const re = /(\w+)@(\w+)/;
const match = re.exec("user@host");
// ["user@host", "user", "host"]
```

Returns `null` if no match.

### `str.match(re)`

Match a string against a pattern (called on the string).

```typescript
const result = "hello world".match(/(\w+)/);
// ["hello", "hello"]
```

Returns `null` if no match. `exec` works for both literal patterns (`/foo/`) and runtime-constructed patterns (`new RegExp(str)`) — the group count is read from the compiled regex at runtime.

## Example

```typescript
const emailPattern = /[a-zA-Z0-9]+@[a-zA-Z0-9]+/;
const input = "contact: user@example.com";

if (emailPattern.test(input)) {
  console.log("contains email");
}
```
