#!/usr/bin/env bash
# Pinned versions for vendor dependencies.
# Update these when pulling in a new upstream version — verify the tag exists first.

BDWGC_TAG="v8.2.8"
YYJSON_TAG="v0.10.0"
LIBUV_TAG="v1.49.2"
TREE_SITTER_TAG="v0.25.3"

# picohttpparser has no formal releases — set this to a specific commit SHA
# Run: git ls-remote https://github.com/h2o/picohttpparser HEAD
PICOHTTPPARSER_COMMIT=""
