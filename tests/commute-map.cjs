const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function sourceBetween(start, end) {
  const offset = html.indexOf(start);
  assert.ok(offset >= 0, 'Missing source section ' + start);
  const finish = html.indexOf(end, offset);
  assert.ok(finish > offset, 'Missing source boundary ' + end);
  return html.slice(offset, finish);
}

const [, encoded] = html.match(/const bytes=Uint8Array\.from\(atob\("([A-Za-z0-9+/=]+)"\)/);
const data = JSON.parse(zlib.inflateSync(Buffer.from(encoded, 'base64')));
const window = {NEST_CITY_DATA: data};
const context = vm.createContext({window});
vm.runInContext(
  sourceBetween('  const metersY=111195, metersX=', '  window.getNestStreetRoute=route;') +
  'window.getNestStreetRoute=route;',
  context,
);
vm.runInContext('const pi = Math.PI;' + sourceBetween('  function gcjToWgs(', '  for(const s of stations)'), context);

const toStreetPoint = (lng, lat) => Object.values(context.gcjToWgs({lng, lat}));
const start = toStreetPoint(116.2992, 40.0588);
const end = toStreetPoint(116.2902, 40.0522);

// 西二旗·示例小区1 → 中关村软件园 used to fail because the origin is over 120 m from a reachable street.
const walk = window.getNestStreetRoute(start, end, 'walk');
assert.ok(walk && walk.lengthMeters > 0, 'The screenshot route should follow a connected street path');
assert.ok(walk.startSnapMeters > 120 && walk.startSnapMeters <= 220);
assert.ok(walk.endSnapMeters < 120);
assert.ok(walk.names.includes('后厂村路'));

const taxi = window.getNestStreetRoute(start, end, 'taxi');
assert.ok(taxi);
for (const tag of [taxi.segs[0], taxi.segs.at(-1)]) {
  assert.ok(!['motorway', 'motorway_link', 'trunk_link'].includes(tag.road));
  assert.ok(!['motorway', 'motorway_link', 'trunk_link'].includes(tag.sub));
}
assert.equal(window.getNestStreetRoute(start, [116.1, 40.8], 'walk'), null);

console.log('Verified the Xierqi route, taxi access and missing street coverage.');
