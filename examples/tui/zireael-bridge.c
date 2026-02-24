/*
  zireael-bridge.c — C bridge between ChadScript and Zireael TUI engine.

  With proper `declare function` support, ChadScript calls external C
  functions by their real names (no _cs_ prefix). TS `declare function
  zr_init()` emits `call @zr_init()` in the IR, matching these C names.

  The bridge manages drawlist construction internally: TypeScript calls
  begin/clear/fill_rect/draw_text/present, and the bridge serializes the
  binary drawlist format that Zireael expects.
*/

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <zr/zr_config.h>
#include <zr/zr_drawlist.h>
#include <zr/zr_engine.h>
#include <zr/zr_event.h>
#include <zr/zr_result.h>
#include <zr/zr_version.h>

/* GC_malloc for returning strings to ChadScript (GC-managed, no leaks) */
extern void *GC_malloc_atomic(size_t size);

/* --- Little-endian helpers (Zireael wire format is LE) --- */

static inline void le16w(uint8_t *p, uint16_t v) {
  p[0] = (uint8_t)(v);
  p[1] = (uint8_t)(v >> 8u);
}

static inline void le32w(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)(v);
  p[1] = (uint8_t)(v >> 8u);
  p[2] = (uint8_t)(v >> 16u);
  p[3] = (uint8_t)(v >> 24u);
}

static inline uint32_t le32r(const uint8_t *p) {
  return ((uint32_t)p[0]) | ((uint32_t)p[1] << 8u) | ((uint32_t)p[2] << 16u) |
         ((uint32_t)p[3] << 24u);
}

static inline uint32_t align4(uint32_t x) { return (x + 3u) & ~3u; }

/* --- Drawlist builder state (reset each frame by zr_begin) --- */

#define CMD_BUF_CAP 16384
#define STRING_POOL_CAP 8192
#define MAX_STRINGS 128

static uint8_t g_cmd_buf[CMD_BUF_CAP];
static uint32_t g_cmd_len;
static uint32_t g_cmd_count;

static char g_string_pool[STRING_POOL_CAP];
static uint32_t g_pool_len;

/* Each string span: offset into pool, length */
static uint32_t g_spans[MAX_STRINGS][2];
static uint32_t g_string_count;

/* --- Helper: add a string to the pool, return its span index --- */
static uint32_t add_string(const char *s) {
  uint32_t len = (uint32_t)strlen(s);
  if (g_string_count >= MAX_STRINGS || g_pool_len + len > STRING_POOL_CAP) {
    return 0; /* fallback: reuse slot 0 */
  }
  uint32_t idx = g_string_count++;
  g_spans[idx][0] = g_pool_len; /* offset */
  g_spans[idx][1] = len;        /* length */
  memcpy(g_string_pool + g_pool_len, s, len);
  g_pool_len += len;
  return idx;
}

/* --- Event buffer for polling --- */
static uint8_t g_event_buf[8192];

/* --- Bridge API (called from ChadScript via `declare function`) --- */

/*
 * Create engine, enter raw mode.
 * Returns opaque engine pointer as i8* (ChadScript "string" type, but
 * never dereferenced in TS — just an opaque handle).
 */
char *zr_init(void) {
  zr_engine_config_t cfg = zr_engine_config_default();
  cfg.requested_engine_abi_major = ZR_ENGINE_ABI_MAJOR;
  cfg.requested_engine_abi_minor = ZR_ENGINE_ABI_MINOR;
  cfg.requested_engine_abi_patch = ZR_ENGINE_ABI_PATCH;
  cfg.requested_drawlist_version = ZR_DRAWLIST_VERSION_V1;
  cfg.requested_event_batch_version = ZR_EVENT_BATCH_VERSION_V1;
  cfg.plat.requested_color_mode = PLAT_COLOR_MODE_RGB;

  zr_engine_t *e = NULL;
  zr_result_t rc = engine_create(&e, &cfg);
  if (rc != ZR_OK) {
    fprintf(stderr, "zireael: engine_create failed: %d\n", (int)rc);
    return NULL;
  }
  return (char *)e;
}

/* Destroy engine, restore terminal. */
void zr_destroy(char *engine) { engine_destroy((zr_engine_t *)engine); }

/*
 * Poll for events, return a simple string describing the first interesting
 * event. ChadScript doesn't have binary buffer parsing, so we do it in C.
 *
 * Returns:
 *   ""              — no events (timeout)
 *   "key:escape"    — escape key pressed
 *   "key:up/down/left/right" — arrow keys
 *   "key:enter"     — enter key
 *   "key:backspace" — backspace key
 *   "key:tab"       — tab key
 *   "text:X"        — text input (single ASCII char)
 *   "resize:W:H"    — terminal resize
 *   "tick"          — tick event
 */
char *zr_poll(char *engine, double timeout_ms) {
  int n = engine_poll_events((zr_engine_t *)engine, (int)timeout_ms,
                             g_event_buf, (int)sizeof(g_event_buf));

  /* Allocate return string in GC memory so ChadScript can use it */
  char *result = (char *)GC_malloc_atomic(128);
  result[0] = '\0';

  if (n <= 0)
    return result;

  /* Validate batch header */
  if ((uint32_t)n < sizeof(zr_evbatch_header_t))
    return result;
  uint32_t magic = le32r(g_event_buf + 0);
  uint32_t total_size = le32r(g_event_buf + 8);
  if (magic != ZR_EV_MAGIC || total_size > (uint32_t)n)
    return result;

  /* Iterate records, return info about the first interesting one */
  uint32_t off = (uint32_t)sizeof(zr_evbatch_header_t);
  while (off + (uint32_t)sizeof(zr_ev_record_header_t) <= total_size) {
    uint32_t type = le32r(g_event_buf + off + 0);
    uint32_t size = le32r(g_event_buf + off + 4);
    if (size < (uint32_t)sizeof(zr_ev_record_header_t) || off + size > total_size)
      break;

    const uint8_t *payload =
        g_event_buf + off + (uint32_t)sizeof(zr_ev_record_header_t);

    if (type == (uint32_t)ZR_EV_KEY) {
      uint32_t key = le32r(payload + 0);
      uint32_t action = le32r(payload + 8);
      /* Only report key-down events */
      if (action == (uint32_t)ZR_KEY_ACTION_DOWN) {
        switch (key) {
        case ZR_KEY_ESCAPE:
          strcpy(result, "key:escape");
          return result;
        case ZR_KEY_ENTER:
          strcpy(result, "key:enter");
          return result;
        case ZR_KEY_TAB:
          strcpy(result, "key:tab");
          return result;
        case ZR_KEY_BACKSPACE:
          strcpy(result, "key:backspace");
          return result;
        case ZR_KEY_UP:
          strcpy(result, "key:up");
          return result;
        case ZR_KEY_DOWN:
          strcpy(result, "key:down");
          return result;
        case ZR_KEY_LEFT:
          strcpy(result, "key:left");
          return result;
        case ZR_KEY_RIGHT:
          strcpy(result, "key:right");
          return result;
        default:
          break;
        }
      }
    } else if (type == (uint32_t)ZR_EV_TEXT) {
      uint32_t codepoint = le32r(payload + 0);
      /* Simple ASCII text input */
      if (codepoint >= 32 && codepoint < 127) {
        snprintf(result, 128, "text:%c", (char)codepoint);
        return result;
      }
    } else if (type == (uint32_t)ZR_EV_RESIZE) {
      uint32_t cols = le32r(payload + 0);
      uint32_t rows = le32r(payload + 4);
      snprintf(result, 128, "resize:%u:%u", cols, rows);
      return result;
    } else if (type == (uint32_t)ZR_EV_TICK) {
      strcpy(result, "tick");
      return result;
    }

    off += align4(size);
  }

  return result;
}

/* Reset drawlist builder for a new frame. */
void zr_begin(char *engine) {
  (void)engine;
  g_cmd_len = 0;
  g_cmd_count = 0;
  g_pool_len = 0;
  g_string_count = 0;
}

/* Append a CLEAR command (8 bytes). */
void zr_clear(char *engine) {
  (void)engine;
  if (g_cmd_len + 8 > CMD_BUF_CAP)
    return;
  le16w(g_cmd_buf + g_cmd_len + 0, (uint16_t)ZR_DL_OP_CLEAR);
  le16w(g_cmd_buf + g_cmd_len + 2, 0);
  le32w(g_cmd_buf + g_cmd_len + 4, 8);
  g_cmd_len += 8;
  g_cmd_count++;
}

/* Append a FILL_RECT command (40 bytes). Colors are 0x00RRGGBB as doubles. */
void zr_fill_rect(char *engine, double x, double y, double w, double h,
                  double fg, double bg) {
  (void)engine;
  if (g_cmd_len + 40 > CMD_BUF_CAP)
    return;
  uint8_t *p = g_cmd_buf + g_cmd_len;
  le16w(p + 0, (uint16_t)ZR_DL_OP_FILL_RECT);
  le16w(p + 2, 0);
  le32w(p + 4, 40);
  le32w(p + 8, (uint32_t)(int32_t)x);
  le32w(p + 12, (uint32_t)(int32_t)y);
  le32w(p + 16, (uint32_t)(int32_t)w);
  le32w(p + 20, (uint32_t)(int32_t)h);
  le32w(p + 24, (uint32_t)fg); /* style.fg */
  le32w(p + 28, (uint32_t)bg); /* style.bg */
  le32w(p + 32, 0);            /* style.attrs */
  le32w(p + 36, 0);            /* style.reserved */
  g_cmd_len += 40;
  g_cmd_count++;
}

/* Append a DRAW_TEXT command (48 bytes). */
void zr_draw_text(char *engine, double x, double y, char *text, double fg,
                  double bg) {
  (void)engine;
  if (g_cmd_len + 48 > CMD_BUF_CAP)
    return;
  uint32_t str_idx = add_string(text);
  uint32_t str_len = (uint32_t)strlen(text);

  uint8_t *p = g_cmd_buf + g_cmd_len;
  le16w(p + 0, (uint16_t)ZR_DL_OP_DRAW_TEXT);
  le16w(p + 2, 0);
  le32w(p + 4, 48);
  le32w(p + 8, (uint32_t)(int32_t)x);   /* x */
  le32w(p + 12, (uint32_t)(int32_t)y);   /* y */
  le32w(p + 16, str_idx);                /* string_index */
  le32w(p + 20, 0);                      /* byte_off */
  le32w(p + 24, str_len);                /* byte_len */
  le32w(p + 28, (uint32_t)fg);           /* style.fg */
  le32w(p + 32, (uint32_t)bg);           /* style.bg */
  le32w(p + 36, 0);                      /* style.attrs */
  le32w(p + 40, 0);                      /* style.reserved */
  le32w(p + 44, 0);                      /* reserved0 */
  g_cmd_len += 48;
  g_cmd_count++;
}

/*
 * Finalize the drawlist, submit it to Zireael, and present.
 * Builds the full binary drawlist:
 *   [64-byte header] [command stream] [string spans] [string pool]
 * Returns 0.0 on success.
 */
double zr_present(char *engine) {
  zr_engine_t *e = (zr_engine_t *)engine;

#define DL_HEADER_SIZE 64u
#define DL_MAGIC 0x4C44525Au

  uint32_t cmd_off = DL_HEADER_SIZE;
  uint32_t spans_off = align4(cmd_off + g_cmd_len);
  uint32_t spans_size =
      g_string_count * 2 * sizeof(uint32_t); /* 8 bytes per span */
  uint32_t pool_off = align4(spans_off + spans_size);
  uint32_t total_size = align4(pool_off + g_pool_len);

  /* Build the drawlist into a stack buffer */
  uint8_t dl_buf[32768];
  if (total_size > sizeof(dl_buf)) {
    return -1.0;
  }

  memset(dl_buf, 0, total_size);

  /* Header (64 bytes) */
  le32w(dl_buf + 0, DL_MAGIC);
  le32w(dl_buf + 4, ZR_DRAWLIST_VERSION_V1);
  le32w(dl_buf + 8, DL_HEADER_SIZE);
  le32w(dl_buf + 12, total_size);
  le32w(dl_buf + 16, cmd_off);
  le32w(dl_buf + 20, g_cmd_len);
  le32w(dl_buf + 24, g_cmd_count);
  le32w(dl_buf + 28, spans_off);
  le32w(dl_buf + 32, g_string_count);
  le32w(dl_buf + 36, pool_off);
  le32w(dl_buf + 40, g_pool_len);
  /* blobs: all zeros (no blobs) */

  /* Command stream */
  memcpy(dl_buf + cmd_off, g_cmd_buf, g_cmd_len);

  /* String spans */
  for (uint32_t i = 0; i < g_string_count; i++) {
    le32w(dl_buf + spans_off + i * 8 + 0, g_spans[i][0]); /* offset */
    le32w(dl_buf + spans_off + i * 8 + 4, g_spans[i][1]); /* length */
  }

  /* String pool */
  memcpy(dl_buf + pool_off, g_string_pool, g_pool_len);

  /* Submit + present */
  zr_result_t rc = engine_submit_drawlist(e, dl_buf, (int)total_size);
  if (rc != ZR_OK) {
    return (double)rc;
  }

  rc = engine_present(e);
  return (double)rc;
}
