// Nullable (`T | undefined`) support. An optional value is a pointer: either the address of
// `cs_undefined_marker` (meaning `undefined`) or a pointer to a GC box holding the boxed inner
// value. These globals exist only for their unique addresses.

char cs_undefined_marker;
char cs_null_marker;
