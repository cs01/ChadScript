#include <stdlib.h>
#include <string.h>
#include <zlib.h>
#include <zstd.h>

extern void *GC_malloc_atomic(size_t size);
extern void *GC_malloc(size_t size);

typedef struct {
  unsigned char *data;
  int length;
  int capacity;
} Uint8Array;

Uint8Array *cs_gzip(const unsigned char *data, int len) {
  uLong bound = compressBound((uLong)len) + 32;
  unsigned char *out = (unsigned char *)GC_malloc_atomic(bound);
  if (!out) return NULL;

  z_stream strm;
  memset(&strm, 0, sizeof(strm));
  if (deflateInit2(&strm, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 15 + 16, 8, Z_DEFAULT_STRATEGY) !=
      Z_OK) {
    return NULL;
  }

  strm.next_in = (Bytef *)data;
  strm.avail_in = (uInt)len;
  strm.next_out = out;
  strm.avail_out = (uInt)bound;

  if (deflate(&strm, Z_FINISH) != Z_STREAM_END) {
    deflateEnd(&strm);
    return NULL;
  }

  int outLen = (int)strm.total_out;
  deflateEnd(&strm);

  Uint8Array *result = (Uint8Array *)GC_malloc(sizeof(Uint8Array));
  if (!result) return NULL;
  result->data = out;
  result->length = outLen;
  result->capacity = outLen;
  return result;
}

Uint8Array *cs_gunzip(const unsigned char *data, int len) {
  uLong outSize = (uLong)len * 4;
  if (outSize < 1024) outSize = 1024;

  z_stream strm;
  memset(&strm, 0, sizeof(strm));
  if (inflateInit2(&strm, 15 + 32) != Z_OK) return NULL;

  strm.next_in = (Bytef *)data;
  strm.avail_in = (uInt)len;

  unsigned char *out = (unsigned char *)GC_malloc_atomic(outSize);
  if (!out) {
    inflateEnd(&strm);
    return NULL;
  }
  strm.next_out = out;
  strm.avail_out = (uInt)outSize;

  int ret;
  while (1) {
    ret = inflate(&strm, Z_NO_FLUSH);
    if (ret == Z_STREAM_END) break;
    if (ret != Z_OK && ret != Z_BUF_ERROR) {
      inflateEnd(&strm);
      return NULL;
    }
    if (strm.avail_out == 0) {
      uLong newSize = outSize * 2;
      unsigned char *newBuf = (unsigned char *)GC_malloc_atomic(newSize);
      if (!newBuf) {
        inflateEnd(&strm);
        return NULL;
      }
      memcpy(newBuf, out, outSize);
      out = newBuf;
      strm.next_out = out + outSize;
      strm.avail_out = (uInt)(newSize - outSize);
      outSize = newSize;
    }
  }

  int outLen = (int)strm.total_out;
  inflateEnd(&strm);

  Uint8Array *result = (Uint8Array *)GC_malloc(sizeof(Uint8Array));
  if (!result) return NULL;
  result->data = out;
  result->length = outLen;
  result->capacity = outLen;
  return result;
}

Uint8Array *cs_deflate_raw(const unsigned char *data, int len) {
  uLong bound = compressBound((uLong)len);
  unsigned char *out = (unsigned char *)GC_malloc_atomic(bound);
  if (!out) return NULL;

  z_stream strm;
  memset(&strm, 0, sizeof(strm));
  if (deflateInit2(&strm, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -15, 8, Z_DEFAULT_STRATEGY) != Z_OK) {
    return NULL;
  }

  strm.next_in = (Bytef *)data;
  strm.avail_in = (uInt)len;
  strm.next_out = out;
  strm.avail_out = (uInt)bound;

  if (deflate(&strm, Z_FINISH) != Z_STREAM_END) {
    deflateEnd(&strm);
    return NULL;
  }

  int outLen = (int)strm.total_out;
  deflateEnd(&strm);

  Uint8Array *result = (Uint8Array *)GC_malloc(sizeof(Uint8Array));
  if (!result) return NULL;
  result->data = out;
  result->length = outLen;
  result->capacity = outLen;
  return result;
}

Uint8Array *cs_inflate_raw(const unsigned char *data, int len) {
  uLong outSize = (uLong)len * 4;
  if (outSize < 1024) outSize = 1024;

  z_stream strm;
  memset(&strm, 0, sizeof(strm));
  if (inflateInit2(&strm, -15) != Z_OK) return NULL;

  strm.next_in = (Bytef *)data;
  strm.avail_in = (uInt)len;

  unsigned char *out = (unsigned char *)GC_malloc_atomic(outSize);
  if (!out) {
    inflateEnd(&strm);
    return NULL;
  }
  strm.next_out = out;
  strm.avail_out = (uInt)outSize;

  int ret;
  while (1) {
    ret = inflate(&strm, Z_NO_FLUSH);
    if (ret == Z_STREAM_END) break;
    if (ret != Z_OK && ret != Z_BUF_ERROR) {
      inflateEnd(&strm);
      return NULL;
    }
    if (strm.avail_out == 0) {
      uLong newSize = outSize * 2;
      unsigned char *newBuf = (unsigned char *)GC_malloc_atomic(newSize);
      if (!newBuf) {
        inflateEnd(&strm);
        return NULL;
      }
      memcpy(newBuf, out, outSize);
      out = newBuf;
      strm.next_out = out + outSize;
      strm.avail_out = (uInt)(newSize - outSize);
      outSize = newSize;
    }
  }

  int outLen = (int)strm.total_out;
  inflateEnd(&strm);

  Uint8Array *result = (Uint8Array *)GC_malloc(sizeof(Uint8Array));
  if (!result) return NULL;
  result->data = out;
  result->length = outLen;
  result->capacity = outLen;
  return result;
}

Uint8Array *cs_zstd_compress(const unsigned char *data, int len) {
  size_t bound = ZSTD_compressBound((size_t)len);
  unsigned char *out = (unsigned char *)GC_malloc_atomic(bound);
  if (!out) return NULL;

  size_t compSize = ZSTD_compress(out, bound, data, (size_t)len, 3);
  if (ZSTD_isError(compSize)) return NULL;

  Uint8Array *r = (Uint8Array *)GC_malloc(sizeof(Uint8Array));
  if (!r) return NULL;
  r->data = out;
  r->length = (int)compSize;
  r->capacity = (int)compSize;
  return r;
}

Uint8Array *cs_zstd_decompress(const unsigned char *data, int len) {
  unsigned long long decompSize = ZSTD_getFrameContentSize(data, (size_t)len);
  if (decompSize == ZSTD_CONTENTSIZE_UNKNOWN || decompSize == ZSTD_CONTENTSIZE_ERROR) {
    decompSize = (unsigned long long)len * 4;
    if (decompSize < 1024) decompSize = 1024;
  }

  unsigned char *out = (unsigned char *)GC_malloc_atomic((size_t)decompSize);
  if (!out) return NULL;

  size_t outSize = ZSTD_decompress(out, (size_t)decompSize, data, (size_t)len);
  if (ZSTD_isError(outSize)) return NULL;

  Uint8Array *r = (Uint8Array *)GC_malloc(sizeof(Uint8Array));
  if (!r) return NULL;
  r->data = out;
  r->length = (int)outSize;
  r->capacity = (int)outSize;
  return r;
}
