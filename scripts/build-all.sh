#!/usr/bin/env bash
# Builds every Nore Client platform into dist/mods (same as "./gradlew build" in the root).
set -euo pipefail
cd "$(dirname "$0")/.."
./gradlew build --no-daemon --console=plain
ls -1 dist/mods
