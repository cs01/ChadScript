#!/usr/bin/env bash
# Pinned versions for vendor dependencies.
# Update these when pulling in a new upstream version — verify the tag exists first.

BDWGC_TAG="v8.2.8"
YYJSON_TAG="0.10.0"
LIBUV_TAG="v1.49.2"
TREE_SITTER_TAG="v0.26.4"

# picohttpparser has no formal releases — pin to a specific commit SHA
# Update by running: git ls-remote https://github.com/h2o/picohttpparser HEAD
PICOHTTPPARSER_COMMIT="f8326098f63eefabfa2b6ec595d90e9ed5ed958a"
