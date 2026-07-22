// String runtime: concatenation and to-string coercions for JS `+` / template literals.
#ifndef CS_STRINGS_H
#define CS_STRINGS_H

char *cs_str_concat(const char *a, const char *b);
char *cs_num_to_string(double x);
const char *cs_bool_to_string(int b);

#endif
