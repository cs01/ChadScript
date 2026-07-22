# ChadScript v2

TypeScript, compiled to native code — take two.

This branch (`v2`) is a ground-up rewrite: an AOT compiler for a **principled, statically
analyzable subset of TypeScript**. Every accepted program behaves exactly like Node runs
it; everything outside the subset is rejected at compile time with a clear diagnostic.
There is no third category.

- **Charter and phase plan:** [`PLAN.md`](PLAN.md) — mission, post-mortem of v1 and hir,
  the language contract, architecture, testing strategy.
- **Standing rules:** [`CLAUDE.md`](CLAUDE.md).
- **v1** (the self-hosting compiler, dead) lives on `main`.

Status: pre-Phase-0. No compiler yet — the tree currently holds the charter plus salvage
from v1 (test fixtures, C bridges, differential-harness sources).
