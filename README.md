# ChadScript v2

TypeScript, compiled to native code — take two.

This branch (`v2`) is a ground-up rewrite: an AOT compiler for a **principled, statically
analyzable subset of TypeScript**. Every accepted program behaves exactly like Node runs
it; everything outside the subset is rejected at compile time with a clear diagnostic.
There is no third category.

- **Charter and phase plan:** [`PLAN.md`](PLAN.md) — mission, post-mortem of v1 and hir,
  the language contract, architecture, testing strategy.
- **Current architecture review:** [`docs/architecture-review-2026-07-22.md`](docs/architecture-review-2026-07-22.md)
  — gates for errors, async, strings, documentation scope, and the standard library.
- **Standing rules:** [`CLAUDE.md`](CLAUDE.md).
- **v1** (the self-hosting compiler, dead) lives on `main`.

Status: Phases 0–2 are complete; later language and standard-library phases are partial. The
validator allowlist plus passing v2 differential fixtures define current support. Most fixtures
outside `tests/fixtures/run/` and `tests/fixtures/reject/` are untriaged v1 salvage, not support
claims.
