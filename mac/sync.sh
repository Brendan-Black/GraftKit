#!/bin/bash
# GraftKit sync for macOS:  curl -fsSL http://<pc>:8765/sync | bash
# Makes this Mac's Minecraft match the server's Graft mods: installs or updates Graft and every published mod, removes
# mods it installed earlier that the server no longer has, and sets up the launcher installation. Safe to rerun.
# The share fills in its own address below; an address given as the first argument takes its place.
set -u
SHARE_URL='@SHARE_URL@'
BASE="${1:-$SHARE_URL}"
LOG=""
say() { echo "$*"; LOG="$LOG$*"$'\n'; }
# A report that can't be sent mustn't fail the sync; the person running it already sees everything on screen.
report() { printf '%s\n%s' "$1" "$LOG" | curl -fsS --max-time 10 --data-binary @- "$BASE/report?kind=sync" >/dev/null 2>&1 || true; }
fail() { say "Problem: $*"; report "sync FAILED: $*"; exit 1; }
[[ "$BASE" =~ ^http://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo "usage: curl -fsSL http://<pc>:8765/sync | bash"; exit 2; }
HOST="${BASE#http://}"; HOST="${HOST%%:*}"

MCDIR="$HOME/Library/Application Support/minecraft"
GRAFT_DIR="$HOME/graft"
MODS="$MCDIR/mods"
STATE="$GRAFT_DIR/graftkit-managed.txt"

sum() { shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1; }
have() { [ -f "$1" ] && [ "$(sum "$1")" = "$2" ]; }
fetch() { # url destination sha256: download beside the destination, check, then move into place
  local tmp="$2.part"
  curl -fsS --max-time 600 -o "$tmp" "$1" || { rm -f "$tmp"; return 1; }
  [ "$(sum "$tmp")" = "$3" ] || { rm -f "$tmp"; say "  checksum mismatch for $(basename "$2")"; return 1; }
  mv -f "$tmp" "$2"
}

echo "GraftKit: syncing with $HOST"
mkdir -p "$GRAFT_DIR" "$MODS" || fail "could not create $GRAFT_DIR or $MODS"
MANIFEST="$(curl -fsS --max-time 20 "$BASE/manifest.txt")" || fail "could not reach $BASE. Is sharing switched on, and is this Mac on the same network?"

MCVER="" PROFILE_NAME="" WANT="" added=0 updated=0 same=0 removed=0
while IFS=$'\t' read -r kind a b c d e; do
  case "$kind" in
    minecraft) MCVER="$a" ;;
    profile) PROFILE_NAME="$a" ;;
    graft)
      if have "$GRAFT_DIR/graft.jar" "$a"; then say "Graft: up to date"
      else fetch "$BASE/files/graft.jar" "$GRAFT_DIR/graft.jar" "$a" || fail "could not download graft.jar"; say "Graft: installed"; fi ;;
    mod)
      file="$c"
      [[ "$file" =~ ^[A-Za-z0-9._+-]+\.jar$ ]] || fail "the server listed an odd file name: $file"
      WANT="$WANT$file"$'\n'
      if have "$MODS/$file" "$a"; then same=$((same+1)); say "  = $file"
      else
        existed=0; [ -f "$MODS/$file" ] && existed=1
        fetch "$BASE/files/mods/$file" "$MODS/$file" "$a" || fail "could not download $file"
        if [ "$existed" = 1 ]; then updated=$((updated+1)); say "  ~ $file (updated)"; else added=$((added+1)); say "  + $file"; fi
      fi ;;
  esac
done <<< "$MANIFEST"
[ -n "$MCVER" ] && [ -n "$PROFILE_NAME" ] || fail "the server's mod list was empty or unreadable"

# Remove mods GraftKit installed earlier that the server no longer publishes. Mods it didn't install are left alone.
if [ -f "$STATE" ]; then
  while IFS= read -r old; do
    [ -z "$old" ] && continue
    if ! printf '%s' "$WANT" | grep -Fxq -- "$old" && [ -f "$MODS/$old" ]; then
      rm -f "$MODS/$old" && removed=$((removed+1)) && say "  - $old (no longer on the server)"
    fi
  done < "$STATE"
fi
printf '%s' "$WANT" > "$STATE.tmp" && mv -f "$STATE.tmp" "$STATE" || fail "could not record which mods GraftKit installed"

# Graft servers refuse players whose mods differ, so point out anything extra.
for f in "$MODS"/*.jar; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  printf '%s' "$WANT" | grep -Fxq -- "$name" || say "  ! $name isn't on the server: move it out of the mods folder, or the server will refuse you"
done

# The launcher installation. The launcher rewrites its settings when it quits, so it has to be closed for this.
PROFILE_STATE="ok"
if pgrep -f "Minecraft.app/Contents/MacOS" >/dev/null 2>&1 || pgrep -xi "minecraft launcher" >/dev/null 2>&1; then
  PROFILE_STATE="skipped"
  say "The Minecraft Launcher is open: quit it (Cmd+Q) and run this again to set up the \"$PROFILE_NAME\" installation."
else
  PJS="$(mktemp "${TMPDIR:-/tmp}/graftkit-profile.XXXXXX")" || fail "could not create a temp file"
  curl -fsS --max-time 20 -o "$PJS" "$BASE/profile.js" || { rm -f "$PJS"; fail "could not download the launcher setup script"; }
  PROFILES="$MCDIR/launcher_profiles.json"
  [ -f "$PROFILES" ] && cp -f "$PROFILES" "$PROFILES.bak-graftkit"
  if out="$(osascript -l JavaScript "$PJS" "$PROFILES" "$GRAFT_DIR/graft.jar" "$MCVER" "$PROFILE_NAME" 2>&1)"; then
    say "Launcher: \"$PROFILE_NAME\" installation ready (Minecraft $MCVER, with Graft)"
  else
    PROFILE_STATE="failed"
    say "Launcher: could not set up the installation: $out"
  fi
  rm -f "$PJS"
fi

say ""
say "Mods: $added added, $updated updated, $same already current, $removed removed."
[ "$PROFILE_STATE" = "ok" ] && say "Done. Open the Minecraft Launcher, pick \"$PROFILE_NAME\" next to Play, and join $HOST."
report "sync $PROFILE_STATE: +$added ~$updated =$same -$removed"
[ "$PROFILE_STATE" != "failed" ]
