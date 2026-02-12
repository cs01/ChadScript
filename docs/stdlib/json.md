# JSON

JSON parsing and serialization via the cJSON library.

## `JSON.parse(str)` / `JSON.parse<T>(str)`

Parse a JSON string. Use a type parameter to get typed access to the result.

```typescript
const data = JSON.parse<MyInterface>(jsonString);
console.log(data.name);
console.log(data.count);
```

Without a type parameter, returns an untyped value:

```typescript
const data = JSON.parse(str);
```

## `JSON.stringify(value)`

Serialize a value to a JSON string.

```typescript
const json = JSON.stringify(myObject);
console.log(json);
```

## Example

```typescript
interface Config {
  host: string;
  port: number;
}

const raw = fs.readFileSync("config.json");
const config = JSON.parse<Config>(raw);
console.log(config.host);
console.log(config.port);
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `JSON.parse()` | cJSON library (`cJSON_Parse`) |
| `JSON.stringify()` | cJSON library (`cJSON_Print`) |
