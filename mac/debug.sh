#!/bin/bash
# GraftKit debug report for macOS:  curl -fsSL http://<pc>:8765/debug | bash
# Read-only: looks at files and runs Java's version check with Graft, prints it all, and sends a copy back.
# The share fills in its own address below; an address given as the first argument takes its place.
SHARE_URL='@SHARE_URL@'
BASE="${1:-$SHARE_URL}"
[[ "$BASE" =~ ^http://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo "usage: curl -fsSL http://<pc>:8765/debug | bash"; exit 2; }
MCDIR="$HOME/Library/Application Support/minecraft"
OUT="$(mktemp "${TMPDIR:-/tmp}/graftkit-debug.XXXXXX")" || { echo "could not create a temp file"; exit 1; }
MANIFEST="$(curl -fsS --max-time 10 "$BASE/manifest.txt" 2>&1)"
MCVER="$(printf '%s\n' "$MANIFEST" | awk -F'\t' '$1=="minecraft"{print $2}')"
GRAFT_SHA="$(printf '%s\n' "$MANIFEST" | awk -F'\t' '$1=="graft"{print $2}')"

{
echo "=== GraftKit debug report, $(date) ==="
echo; echo "--- system ---"; sw_vers 2>&1; uname -m
echo; echo "--- graft.jar (the server has sha256 $GRAFT_SHA) ---"
ls -l "$HOME/graft/graft.jar" 2>&1; shasum -a 256 "$HOME/graft/graft.jar" 2>&1
echo; echo "--- mods folder ---"; ls -l "$MCDIR/mods" 2>&1; shasum -a 256 "$MCDIR"/mods/*.jar 2>&1
echo; echo "--- the server's mod list ---"; printf '%s\n' "$MANIFEST"
echo; echo "--- installed by GraftKit ---"; cat "$HOME/graft/graftkit-managed.txt" 2>&1
echo; echo "--- launcher installations ---"
grep -E '"(name|lastVersionId|javaArgs|javaDir|gameDir)"' "$MCDIR/launcher_profiles.json" 2>&1
echo; echo "--- unusual characters in JVM arguments (should say: none) ---"
grep '"javaArgs"' "$MCDIR/launcher_profiles.json" 2>/dev/null | LC_ALL=C grep -n '[^ -~]' || echo "none"
echo; echo "--- every -javaagent in the launcher, and whether its file exists ---"
grep -o -- '-javaagent:[^ "]*' "$MCDIR/launcher_profiles.json" 2>/dev/null | sort -u | while read -r a; do
  p="${a#-javaagent:}"; if [ -f "$p" ]; then echo "ok       $a"; else echo "MISSING  $a"; fi
done
echo; echo "--- bundled Java ---"
COMP="$(grep -o '"component" *: *"[^"]*"' "$MCDIR/versions/$MCVER/$MCVER.json" 2>/dev/null | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')"
echo "$MCVER uses runtime: [$COMP]"
JAVA="$(find "$MCDIR/runtime/$COMP" -path '*/bin/java' -type f 2>/dev/null | head -n 1)"
[ -z "$JAVA" ] && JAVA="$(find "$MCDIR/runtime" -path '*/bin/java' -type f 2>/dev/null | head -n 1)"
echo "java: [$JAVA]"
if [ -n "$JAVA" ]; then
  "$JAVA" -version 2>&1
  echo; echo "--- bundled Java with -javaagent:$HOME/graft/graft.jar (GRAFT-501 here means Graft loads fine) ---"
  "$JAVA" "-javaagent:$HOME/graft/graft.jar" -version 2>&1 | head -n 12
fi
echo; echo "--- launcher log around errors ---"
grep -E -B 8 -A 3 'initialization of VM|xit code|Error opening|GRAFT-' "$MCDIR/launcher_log.txt" 2>&1 | tail -n 80
echo; echo "--- game log (last 40 lines) ---"; tail -n 40 "$MCDIR/logs/latest.log" 2>&1
echo; echo "--- crash reports ---"; ls -lt "$MCDIR/crash-reports" 2>&1 | head -n 5
} > "$OUT" 2>&1

cat "$OUT"; echo
if curl -fsS --max-time 20 --data-binary @"$OUT" "$BASE/report?kind=debug" >/dev/null; then
  echo "Report sent."
else
  echo "Could not send it. Copy everything above and send it instead."
fi
rm -f "$OUT"
