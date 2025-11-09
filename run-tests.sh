#!/bin/bash

# ChadScript Test Runner
# Runs the full test suite using Node's built-in test runner

set -e

echo "======================================"
echo "  ChadScript Compiler Test Suite"
echo "======================================"
echo ""

# Check if LLVM tools are available
if ! command -v llc &> /dev/null; then
    echo "❌ Error: llc not found. Please install LLVM."
    exit 1
fi

if ! command -v clang &> /dev/null; then
    echo "❌ Error: clang not found. Please install clang."
    exit 1
fi

echo "✓ LLVM tools found"
echo ""

# Run tests
echo "Running tests..."
echo ""

npm test

echo ""
echo "======================================"
echo "  All tests passed! ✓"
echo "======================================"
