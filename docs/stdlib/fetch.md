# fetch

HTTP client via `libcurl`. Returns a `Promise` — must be used with `await` inside an `async` function.

## Usage

```typescript
async function main(): any {
  const response = await fetch("https://api.example.com/data");
  const body = response.text();       // string — response body
  const data = response.json<T>();    // parsed JSON with type
  const status = response.status;     // number — HTTP status code
  const ok = response.ok;             // boolean — true if 2xx
}
```

## Response Object

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code (200, 404, 500, etc.) |
| `ok` | `boolean` | `true` if status is in the 200-299 range |

| Method | Returns | Description |
|--------|---------|-------------|
| `text()` | `string` | Response body as a string |
| `json<T>()` | `T` | Parse response body as JSON with type parameter |

## Example

```typescript
interface Repo {
  name: string;
  description: string;
}

async function main(): any {
  const response = await fetch("https://api.github.com/repos/cs01/ChadScript");
  const repo = response.json<Repo>();
  console.log(repo.name);
  console.log(repo.description);
}
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `fetch()` | libcurl (`curl_easy_perform`) on libuv thread pool |
