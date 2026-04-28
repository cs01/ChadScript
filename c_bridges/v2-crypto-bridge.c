#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <CommonCrypto/CommonDigest.h>

static const char hex_chars[] = "0123456789abcdef";

static char *bytes_to_hex(const unsigned char *bytes, size_t len) {
  char *hex = (char *)malloc(len * 2 + 1);
  for (size_t i = 0; i < len; i++) {
    hex[i * 2] = hex_chars[bytes[i] >> 4];
    hex[i * 2 + 1] = hex_chars[bytes[i] & 0x0f];
  }
  hex[len * 2] = '\0';
  return hex;
}

static const char b64_chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static char *bytes_to_base64(const unsigned char *bytes, size_t len) {
  size_t out_len = 4 * ((len + 2) / 3);
  char *out = (char *)malloc(out_len + 1);
  size_t j = 0;
  for (size_t i = 0; i < len; i += 3) {
    uint32_t a = bytes[i];
    uint32_t b = (i + 1 < len) ? bytes[i + 1] : 0;
    uint32_t c = (i + 2 < len) ? bytes[i + 2] : 0;
    uint32_t triple = (a << 16) | (b << 8) | c;
    out[j++] = b64_chars[(triple >> 18) & 0x3f];
    out[j++] = b64_chars[(triple >> 12) & 0x3f];
    out[j++] = (i + 1 < len) ? b64_chars[(triple >> 6) & 0x3f] : '=';
    out[j++] = (i + 2 < len) ? b64_chars[triple & 0x3f] : '=';
  }
  out[j] = '\0';
  return out;
}

char *cs2_crypto_random_bytes_hex(double n) {
  int count = (int)n;
  unsigned char *buf = (unsigned char *)malloc(count);
  arc4random_buf(buf, count);
  char *hex = bytes_to_hex(buf, count);
  free(buf);
  return hex;
}

char *cs2_crypto_hash(const char *algo, const char *data, const char *encoding) {
  unsigned char digest[CC_SHA512_DIGEST_LENGTH];
  size_t digest_len;
  size_t data_len = strlen(data);

  if (strcmp(algo, "sha256") == 0) {
    CC_SHA256((const unsigned char *)data, (CC_LONG)data_len, digest);
    digest_len = CC_SHA256_DIGEST_LENGTH;
  } else if (strcmp(algo, "sha1") == 0) {
    CC_SHA1((const unsigned char *)data, (CC_LONG)data_len, digest);
    digest_len = CC_SHA1_DIGEST_LENGTH;
  } else if (strcmp(algo, "sha512") == 0) {
    CC_SHA512((const unsigned char *)data, (CC_LONG)data_len, digest);
    digest_len = CC_SHA512_DIGEST_LENGTH;
  } else if (strcmp(algo, "md5") == 0) {
    CC_MD5((const unsigned char *)data, (CC_LONG)data_len, digest);
    digest_len = CC_MD5_DIGEST_LENGTH;
  } else {
    fprintf(stderr, "Error: unsupported hash algorithm '%s'\n", algo);
    exit(1);
  }

  if (strcmp(encoding, "hex") == 0) {
    return bytes_to_hex(digest, digest_len);
  } else if (strcmp(encoding, "base64") == 0) {
    return bytes_to_base64(digest, digest_len);
  } else {
    fprintf(stderr, "Error: unsupported digest encoding '%s'\n", encoding);
    exit(1);
  }
}
