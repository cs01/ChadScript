// ChadScript JSX TUI Demo — declarative version of the Zireael counter app
//
// Same interactive counter as app.tsx, but uses JSX syntax for the draw calls.
// JSX desugars <Tag prop={v} /> to createElement("Tag", {prop: v}, []).
// Our createElement draws directly to the terminal as a side effect.
//
// Build: bash examples/tui/build.sh
// Run:   .build/examples/tui/app-jsx

// FFI: zireael-bridge.c — engine lifecycle
declare function zr_init(): i8_ptr;
declare function zr_destroy(engine: i8_ptr): void;

// FFI: zireael-bridge.c — event polling (returns "key:escape", "key:up", etc.)
declare function zr_poll(engine: i8_ptr, timeout_ms: i32): i8_ptr;

// FFI: zireael-bridge.c — drawlist construction
declare function zr_begin(engine: i8_ptr): void;
declare function zr_clear(engine: i8_ptr): void;
declare function zr_fill_rect(
  engine: i8_ptr,
  x: i32,
  y: i32,
  w: i32,
  h: i32,
  fg: u32,
  bg: u32,
): void;
declare function zr_draw_text(engine: i8_ptr, x: i32, y: i32, text: i8_ptr, fg: u32, bg: u32): void;
declare function zr_present(engine: i8_ptr): f64;

// Colors (0x00RRGGBB)
const WHITE = 0xffffff;
const CYAN = 0x00ffff;
const GRAY = 0x888888;
const DARK_BLUE = 0x002244;
const BLACK = 0x000000;
const GREEN = 0x00ff88;

// Props for all JSX elements — every element receives the full set.
// Box uses x/y/w/h/fg/bg for fill_rect; Text uses x/y/text/fg/bg for draw_text.
interface Props {
  x: number;
  y: number;
  w: number;
  h: number;
  fg: number;
  bg: number;
  text: string;
}

// Module-level engine so createElement can access it
const engine = zr_init();

// Side-effect createElement: draws to the terminal immediately via Zireael FFI.
// JSX evaluates children before parents (inner-to-outer), so we use flat fragments
// (<>...</>) instead of nesting — this gives us left-to-right draw order, ensuring
// backgrounds (Box) render before foreground text (Text).
function createElement(tag: string, props: Props, children: string[]): string {
  if (tag === "Box") {
    zr_fill_rect(engine, props.x, props.y, props.w, props.h, props.fg, props.bg);
  } else if (tag === "Text") {
    zr_draw_text(engine, props.x, props.y, props.text, props.fg, props.bg);
  }
  // "Fragment" (from <>) does nothing — just groups siblings for ordering
  return tag;
}

let count = 0;
let running = true;

while (running) {
  const event = zr_poll(engine, 16);

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

  // JSX renders via side effects — each element triggers zr_fill_rect or zr_draw_text.
  // Fragment (<>) ensures left-to-right evaluation: Box backgrounds draw first, then Text.
  const ui = (
    <>
      <Box x={0} y={0} w={50} h={1} fg={WHITE} bg={DARK_BLUE} text="" />
      <Text x={2} y={0} w={0} h={0} fg={CYAN} bg={DARK_BLUE} text="ChadScript JSX TUI" />
      <Text x={2} y={2} w={0} h={0} fg={GREEN} bg={BLACK} text={"Counter: " + count.toString()} />
      <Text x={2} y={4} w={0} h={0} fg={GRAY} bg={BLACK} text="UP/DOWN  +/- 1" />
      <Text x={2} y={5} w={0} h={0} fg={GRAY} bg={BLACK} text="LEFT/RIGHT  +/- 10" />
      <Text x={2} y={6} w={0} h={0} fg={GRAY} bg={BLACK} text="ESC  quit" />
    </>
  );

  zr_present(engine);
}

zr_destroy(engine);
