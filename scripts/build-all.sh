#!/usr/bin/env bash
# Builds every Nore Client platform into dist/mods (same as "./gradlew build" in the root),
# then the platforms that have their own gradlew (26.x+: Gradle 9, Java 25, no remapping).
set -euo pipefail
cd "$(dirname "$0")/.."
./gradlew build --no-daemon --console=plain

JDK25="${JAVA_HOME_25_X64:-${JAVA25_HOME:-}}"
if [ -z "$JDK25" ]; then
  for d in /usr/lib/jvm/java-25-openjdk-amd64 /usr/lib/jvm/temurin-25-jdk-amd64 /Library/Java/JavaVirtualMachines/temurin-25.jdk/Contents/Home; do
    [ -x "$d/bin/javac" ] && JDK25="$d" && break
  done
fi
for p in platforms/*/; do
  [ -f "$p/gradlew" ] || continue
  if [ -z "$JDK25" ]; then
    echo "Pomijam $p: potrzebny JDK 25 (ustaw JAVA25_HOME)" >&2
    continue
  fi
  echo "== $p (Java 25)"
  (cd "$p" && JAVA_HOME="$JDK25" ./gradlew build --no-daemon --console=plain)
done
ls -1 dist/mods
