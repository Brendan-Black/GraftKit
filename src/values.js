// Values with a shape, checked where they enter: anything that ends up inside a server command or a file name.

/** A Minecraft account name: 3 to 16 letters, digits or underscores. */
function playerName(s) {
  const v = String(s ?? '');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(v)) throw new Error(`"${v}" isn't a Minecraft player name`);
  return v;
}

/** A player name, or one of the selectors GraftKit accepts in its place. */
function playerOrSelector(s) {
  return ['@a', '@p', '@r'].includes(String(s)) ? String(s) : playerName(s);
}

/** A jar file name with no path in it. */
function jarFileName(s) {
  const v = String(s ?? '');
  if (!/^[\w.+-]+\.jar$/.test(v)) throw new Error(`"${v}" isn't a plain jar file name`);
  return v;
}

/** A whole number within bounds, for counts and sizes taken from options. */
function intIn(s, lo, hi, what) {
  const n = Number(s);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${what} must be a whole number from ${lo} to ${hi}, not "${s}"`);
  return n;
}

/** A WSL path seen from Windows (\\wsl.localhost\<distro>\... or \\wsl$\<distro>\...), or null for anything else. */
function wslLocation(p) {
  const m = String(p).match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i);
  if (!m) return null;
  return { distro: m[1], linuxPath: (m[2] || '\\').replace(/\\/g, '/') };
}

module.exports = { playerName, playerOrSelector, jarFileName, intIn, wslLocation };
