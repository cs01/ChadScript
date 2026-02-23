# JSON

JSON parsing and serialization via the yyjson library.

## `JSON.parse<T>(str)`

Parse a JSON string into a typed struct. The type parameter `T` is **required** — ChadScript generates a specialized parser at compile time based on the interface's field names and types. Calling `JSON.parse()` without a type parameter is a compile error.

```typescript
interface Config {
  host: string;
  port: number;
}

const config = JSON.parse<Config>('{"host":"localhost","port":8080}');
console.log(config.host);
console.log(config.port);
```

### Safety

Missing or wrong-typed fields get safe zero values instead of crashing:

| Scenario | Behavior |
|----------|----------|
| Field missing from JSON | `""` for strings, `0` for numbers, `false` for booleans |
| Field has wrong type | Same defaults as missing |
| Invalid JSON string | Returns struct with all defaults |

```typescript
interface User {
  name: string;
  age: number;
}

const partial = JSON.parse<User>('{"name":"Alice"}');
// partial.age === 0 (safe default, no crash)

const invalid = JSON.parse<User>('not json');
// invalid.name === "" (safe default, no crash)
```

## `JSON.stringify(value)`

Serialize a value to a JSON string.

```typescript
const json = JSON.stringify(myObject);
console.log(json);
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `JSON.parse<T>()` | yyjson library (`yyjson_read` + generated field extractor) |
| `JSON.stringify()` | yyjson library (`yyjson_mut_write`) |
