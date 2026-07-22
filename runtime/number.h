// JS-exact number-to-string. `out` must hold at least 32 bytes.
#ifndef CS_NUMBER_H
#define CS_NUMBER_H

void cs_num_to_str(double x, char *out);

// ECMAScript ToInt32: coerces a JS number to a signed 32-bit int (NaN/Inf → 0, else truncate +
// mod 2^32). The raw bits double as ToUint32 for the caller.
int cs_to_int32(double x);

#endif
