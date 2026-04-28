#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  unsigned char *data;
  int len;
} ChadBuffer;

static const char hex_chars[] = "0123456789abcdef";

static const char b64_chars[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static int hex_val(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}

static const unsigned char b64_decode[256] = {
    ['A'] = 0,  ['B'] = 1,  ['C'] = 2,  ['D'] = 3,  ['E'] = 4,  ['F'] = 5,
    ['G'] = 6,  ['H'] = 7,  ['I'] = 8,  ['J'] = 9,  ['K'] = 10, ['L'] = 11,
    ['M'] = 12, ['N'] = 13, ['O'] = 14, ['P'] = 15, ['Q'] = 16, ['R'] = 17,
    ['S'] = 18, ['T'] = 19, ['U'] = 20, ['V'] = 21, ['W'] = 22, ['X'] = 23,
    ['Y'] = 24, ['Z'] = 25, ['a'] = 26, ['b'] = 27, ['c'] = 28, ['d'] = 29,
    ['e'] = 30, ['f'] = 31, ['g'] = 32, ['h'] = 33, ['i'] = 34, ['j'] = 35,
    ['k'] = 36, ['l'] = 37, ['m'] = 38, ['n'] = 39, ['o'] = 40, ['p'] = 41,
    ['q'] = 42, ['r'] = 43, ['s'] = 44, ['t'] = 45, ['u'] = 46, ['v'] = 47,
    ['w'] = 48, ['x'] = 49, ['y'] = 50, ['z'] = 51, ['0'] = 52, ['1'] = 53,
    ['2'] = 54, ['3'] = 55, ['4'] = 56, ['5'] = 57, ['6'] = 58, ['7'] = 59,
    ['8'] = 60, ['9'] = 61, ['+'] = 62, ['/'] = 63,
};

void *cs2_buffer_from_string(const char *str, const char *encoding) {
  ChadBuffer *buf = (ChadBuffer *)malloc(sizeof(ChadBuffer));

  if (strcmp(encoding, "utf8") == 0 || strcmp(encoding, "utf-8") == 0) {
    int len = (int)strlen(str);
    buf->data = (unsigned char *)malloc(len);
    memcpy(buf->data, str, len);
    buf->len = len;
  } else if (strcmp(encoding, "hex") == 0) {
    int slen = (int)strlen(str);
    int len = slen / 2;
    buf->data = (unsigned char *)malloc(len);
    for (int i = 0; i < len; i++) {
      buf->data[i] =
          (unsigned char)((hex_val(str[i * 2]) << 4) | hex_val(str[i * 2 + 1]));
    }
    buf->len = len;
  } else if (strcmp(encoding, "base64") == 0) {
    int slen = (int)strlen(str);
    int pad = 0;
    if (slen > 0 && str[slen - 1] == '=') pad++;
    if (slen > 1 && str[slen - 2] == '=') pad++;
    int out_len = (slen / 4) * 3 - pad;
    buf->data = (unsigned char *)malloc(out_len);
    buf->len = out_len;
    int j = 0;
    for (int i = 0; i < slen; i += 4) {
      unsigned int a = b64_decode[(unsigned char)str[i]];
      unsigned int b = b64_decode[(unsigned char)str[i + 1]];
      unsigned int c = b64_decode[(unsigned char)str[i + 2]];
      unsigned int d = b64_decode[(unsigned char)str[i + 3]];
      unsigned int triple = (a << 18) | (b << 12) | (c << 6) | d;
      if (j < out_len) buf->data[j++] = (triple >> 16) & 0xff;
      if (j < out_len) buf->data[j++] = (triple >> 8) & 0xff;
      if (j < out_len) buf->data[j++] = triple & 0xff;
    }
  } else {
    fprintf(stderr, "Error: unsupported Buffer encoding '%s'\n", encoding);
    exit(1);
  }

  return buf;
}

void *cs2_buffer_alloc(double size) {
  int len = (int)size;
  ChadBuffer *buf = (ChadBuffer *)malloc(sizeof(ChadBuffer));
  buf->data = (unsigned char *)calloc(len, 1);
  buf->len = len;
  return buf;
}

char *cs2_buffer_to_string(void *ptr, const char *encoding) {
  ChadBuffer *buf = (ChadBuffer *)ptr;

  if (strcmp(encoding, "utf8") == 0 || strcmp(encoding, "utf-8") == 0) {
    char *out = (char *)malloc(buf->len + 1);
    memcpy(out, buf->data, buf->len);
    out[buf->len] = '\0';
    return out;
  } else if (strcmp(encoding, "hex") == 0) {
    char *out = (char *)malloc(buf->len * 2 + 1);
    for (int i = 0; i < buf->len; i++) {
      out[i * 2] = hex_chars[buf->data[i] >> 4];
      out[i * 2 + 1] = hex_chars[buf->data[i] & 0x0f];
    }
    out[buf->len * 2] = '\0';
    return out;
  } else if (strcmp(encoding, "base64") == 0) {
    int out_len = 4 * ((buf->len + 2) / 3);
    char *out = (char *)malloc(out_len + 1);
    int j = 0;
    for (int i = 0; i < buf->len; i += 3) {
      unsigned int a = buf->data[i];
      unsigned int b = (i + 1 < buf->len) ? buf->data[i + 1] : 0;
      unsigned int c = (i + 2 < buf->len) ? buf->data[i + 2] : 0;
      unsigned int triple = (a << 16) | (b << 8) | c;
      out[j++] = b64_chars[(triple >> 18) & 0x3f];
      out[j++] = b64_chars[(triple >> 12) & 0x3f];
      out[j++] = (i + 1 < buf->len) ? b64_chars[(triple >> 6) & 0x3f] : '=';
      out[j++] = (i + 2 < buf->len) ? b64_chars[triple & 0x3f] : '=';
    }
    out[j] = '\0';
    return out;
  } else {
    fprintf(stderr, "Error: unsupported Buffer encoding '%s'\n", encoding);
    exit(1);
  }
}

double cs2_buffer_length(void *ptr) {
  ChadBuffer *buf = (ChadBuffer *)ptr;
  return (double)buf->len;
}

double cs2_buffer_at(void *ptr, double index) {
  ChadBuffer *buf = (ChadBuffer *)ptr;
  int idx = (int)index;
  if (idx < 0 || idx >= buf->len) return 0;
  return (double)buf->data[idx];
}
