// ChadScript TUI Demo — Zireael-powered native terminal app
//
// A simple interactive counter demonstrating the full render loop:
//   poll events → update state → build drawlist → present
//
// Build: bash examples/tui/build.sh
// Run:   .build/examples/tui/app

// FFI: zireael-bridge.c — engine lifecycle
declare function zr_init(): string;
declare function zr_destroy(engine: string): void;

// FFI: zireael-bridge.c — event polling (returns "key:escape", "key:up", etc.)
declare function zr_poll(engine: string, timeout_ms: number): string;

// FFI: zireael-bridge.c — drawlist construction
declare function zr_begin(engine: string): void;
declare function zr_clear(engine: string): void;
declare function zr_fill_rect(engine: string, x: number, y: number, w: number, h: number, fg: number, bg: number): void;
declare function zr_draw_text(engine: string, x: number, y: number, text: string, fg: number, bg: number): void;
declare function zr_present(engine: string): number;

// Colors (0x00RRGGBB)
const WHITE = 0xFFFFFF;
const CYAN = 0x00FFFF;
const GRAY = 0x888888;
const DARK_BLUE = 0x002244;
const BLACK = 0x000000;
const GREEN = 0x00FF88;
const YELLOW = 0xFFCC00;

const engine = zr_init();
let count = 0;
let running = true;

while (running) {
  const event = zr_poll(engine, 16);
  console.log(event);
  if (event === "key:escape") {
    running = false;
  } else if (event === "key:up") {
    count = count + 1;
  } else if (event === "key:down") {
    count = count - 1;
  } else if (event === "key:right") {
    count = count + 10;
  } else if (event === "key:left") {
    count = count - 10;
  }

  zr_begin(engine);
  zr_clear(engine);

  // Header bar
  zr_fill_rect(engine, 0, 0, 50, 1, WHITE, DARK_BLUE);
  zr_draw_text(engine, 2, 0, "ChadScript TUI Demo", CYAN, DARK_BLUE);

  // Counter display
  zr_draw_text(engine, 2, 2, "Counter: " + count.toString(), GREEN, GREEN);

  // Instructions
  zr_draw_text(engine, 2, 4, "UP/DOWN  +/- 1", GRAY, BLACK);
  zr_draw_text(engine, 2, 5, "LEFT/RIGHT  +/- 10", GRAY, BLACK);
  zr_draw_text(engine, 2, 6, "ESC  quit", GRAY, BLACK);

  zr_present(engine);
}

zr_destroy(engine);
