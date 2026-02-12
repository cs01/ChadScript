# Low-Level / Syscalls

ChadScript provides direct access to POSIX system calls for advanced use cases like networking and manual memory management. These are global functions available without imports.

::: warning
These are low-level APIs. For most use cases, prefer the higher-level stdlib modules (`fs`, `fetch`, `httpServe`, etc.).
:::

## Memory Management

### `malloc(size)`

Allocate memory on the heap.

```typescript
const ptr = malloc(1024);    // allocate 1024 bytes
```

### `free(ptr)`

Free memory allocated by `malloc`.

```typescript
free(ptr);
```

## Socket Networking

### `socket(domain, type, protocol)`

Create a socket endpoint.

```typescript
const fd = socket(2, 1, 0);    // AF_INET, SOCK_STREAM, default protocol
```

### `bind(socket, addr, addrlen)`

Bind a socket to an address.

```typescript
bind(fd, addr, 16);
```

### `listen(socket, backlog)`

Mark a socket as passive, ready to accept connections.

```typescript
listen(fd, 128);
```

### `accept(socket, addr, addrlen)`

Accept an incoming connection.

```typescript
const client = accept(fd, 0, 0);
```

### `htons(hostshort)`

Convert a 16-bit number from host to network byte order.

```typescript
const port = htons(8080);
```

## Low-Level I/O

### `read(fd, buf, count)`

Read bytes from a file descriptor.

```typescript
const n = read(fd, buf, 1024);    // returns bytes read
```

### `write(fd, buf, count)`

Write bytes to a file descriptor.

```typescript
write(fd, buf, len);
```

### `close(fd)`

Close a file descriptor.

```typescript
close(fd);
```

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `AF_INET` | 2 | IPv4 |
| `SOCK_STREAM` | 1 | TCP |
| `SOCK_DGRAM` | 2 | UDP |
