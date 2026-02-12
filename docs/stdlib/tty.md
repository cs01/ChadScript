# tty

Terminal detection.

## `tty.isatty()`

Check if stdout is connected to a terminal.

```typescript
if (tty.isatty()) {
  console.log("Running in a terminal");
} else {
  console.log("Output is being piped");
}
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `tty.isatty()` | `isatty(STDOUT_FILENO)` |
