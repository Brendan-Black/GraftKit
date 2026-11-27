// Adds or repairs GraftKit's installation in the Minecraft Launcher (launcher_profiles.json), so the game starts with
// Graft. On the Mac it runs as JavaScript for Automation:
//   osascript -l JavaScript profile.js <launcher_profiles.json> <graft.jar> <minecraft version> <installation name>
// upsert() is plain JavaScript, so GraftKit's tests run it under Node too.
var DEFAULT_ARGS = '-Xmx4G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 ' +
  '-XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M';

function upsert(text, agentJar, version, name, now) {
  var data;
  try {
    data = text && text.trim() ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error('launcher_profiles.json is not valid JSON; leaving it alone');
  }
  if (!data.profiles || typeof data.profiles !== 'object') data.profiles = {};
  var old = data.profiles.graftkit || {};
  // Keep any memory or GC settings the player chose; only the -javaagent part is GraftKit's.
  var rest = String(old.javaArgs || DEFAULT_ARGS).split(/\s+/).filter(function (a) { return a && !/^-javaagent:/.test(a); });
  var profile = {};
  for (var k in old) profile[k] = old[k];
  profile.name = name;
  profile.type = 'custom';
  profile.lastVersionId = version;
  profile.icon = old.icon || 'Furnace';
  profile.created = old.created || now;
  profile.lastUsed = old.lastUsed || now;
  profile.javaArgs = ['-javaagent:' + agentJar].concat(rest).join(' ');
  data.profiles.graftkit = profile;
  return JSON.stringify(data, null, 2);
}

// JXA entry point (osascript calls run with the command-line arguments).
function run(argv) {
  ObjC.import('Foundation');
  var file = argv[0], agentJar = argv[1], version = argv[2], name = argv[3];
  var text = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(file, $.NSUTF8StringEncoding, null)) || '';
  var out = upsert(text, agentJar, version, name, new Date().toISOString());
  if (!$(out).writeToFileAtomicallyEncodingError(file, true, $.NSUTF8StringEncoding, null)) {
    throw new Error('could not write ' + file);
  }
  return 'ok';
}

if (typeof module !== 'undefined') module.exports = { upsert: upsert, DEFAULT_ARGS: DEFAULT_ARGS };
