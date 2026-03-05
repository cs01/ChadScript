# crypto

Cryptographic hash functions and random bytes via OpenSSL (`libcrypto`). All hash functions return hex-encoded strings.

## `crypto.sha256(input)`

Compute SHA-256 hash of a string.

```typescript
const hash = crypto.sha256("hello");
// "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
```

## `crypto.sha512(input)`

Compute SHA-512 hash of a string.

```typescript
const hash = crypto.sha512("hello");
```

## `crypto.md5(input)`

Compute MD5 hash of a string.

```typescript
const hash = crypto.md5("hello");
// "5d41402abc4b2a76b9719d911017c592"
```

## `crypto.randomBytes(n)`

Generate `n` random bytes, returned as a hex string (2n characters).

```typescript
const token = crypto.randomBytes(16);
// 32-character random hex string, e.g. "a1b2c3d4e5f6..."
```

## `crypto.randomUUID()`

Generate a v4 UUID string.

```typescript
const id = crypto.randomUUID();
// "550e8400-e29b-41d4-a716-446655440000"
```

## `crypto.hmacSha256(key, message)`

Compute HMAC-SHA256 of `message` using `key`. Returns a 64-character hex string.

```typescript
const sig = crypto.hmacSha256("secret", "hello");
// e.g. "88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b"
```

## `crypto.pbkdf2(password, salt, iterations, keyLen)`

Derive a key from `password` and `salt` using PBKDF2-HMAC-SHA256. Returns a hex string of length `keyLen * 2`.

```typescript
const key = crypto.pbkdf2("password", "salt", 100000, 32);
// 64-character hex string
```

## Example

```typescript
const password = "secret123";
const hash = crypto.sha256(password);
console.log(hash);

const sessionId = crypto.randomBytes(32);
console.log(sessionId);

const uuid = crypto.randomUUID();
console.log(uuid);
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `crypto.sha256()` | OpenSSL EVP API (`EVP_sha256`) |
| `crypto.sha512()` | OpenSSL EVP API (`EVP_sha512`) |
| `crypto.md5()` | OpenSSL EVP API (`EVP_md5`) |
| `crypto.randomBytes()` | `RAND_bytes()` |
| `crypto.randomUUID()` | `RAND_bytes(16)` + version/variant bits + `snprintf` |
| `crypto.hmacSha256()` | OpenSSL `HMAC()` with `EVP_sha256` |
| `crypto.pbkdf2()` | OpenSSL `PKCS5_PBKDF2_HMAC()` with `EVP_sha256` |
