const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'housing', 'static', 'housing', 'frontend', 'pages', 'main.js'), 'utf8');
function sourceBetween(start, end) {
  const offset = script.indexOf(start);
  assert.ok(offset >= 0, 'Missing source section ' + start);
  const finish = script.indexOf(end, offset);
  assert.ok(finish > offset, 'Missing source boundary ' + end);
  return script.slice(offset, finish);
}

// Exercise the planner and the renderer used by the standalone and Django pages.
const context = vm.createContext({});
vm.runInContext(
  sourceBetween('const mulberry32 =', 'const isoDate') +
  sourceBetween('const NEST_STYLES =', 'function nsvg(') +
  sourceBetween('  const TAU=Math.PI*2', '  const vertexSource=') +
  'this.api = {parseCSV, nestCharacter, planInterior, interior};',
  context,
);
const {parseCSV, nestCharacter, planInterior, interior} = context.api;
const csv = fs.readFileSync(path.join(root, 'beijing-central-shared-rent-synthetic.csv'), 'utf8');
const listings = parseCSV(csv).map(row => ({
  key: row.listing_id,
  layout: row.layout,
  rooms: parseInt(row.layout, 10),
  roomType: row.room_type,
  roomSqm: +row.room_area_sqm,
  aptSqm: +row.apartment_area_sqm,
  channel: row.rental_channel,
  district: row.district,
  area: row.area,
  elevator: row.has_elevator === '有',
  roommates: JSON.parse(row.roommates_json),
}));

function overlap(a, b, gap = 0) {
  return a.x < b.x + b.w + gap - 1e-6 && a.x + a.w > b.x - gap + 1e-6 &&
    a.z < b.z + b.d + gap - 1e-6 && a.z + a.d > b.z - gap + 1e-6;
}

function checkPlan(listing, plan) {
  const bedrooms = plan.zones.filter(zone => zone.type === 'bedroom');
  assert.equal(bedrooms.length, parseInt(listing.layout, 10));
  assert.equal(plan.zones.filter(zone => zone.type === 'bathroom').length, plan.bathroomCount);
  assert.equal(bedrooms.filter(zone => zone.selected).length, 1);
  if (listing.roomType.includes('独卫')) {
    assert.ok(plan.zones.some(zone => zone.id === 'bedroom-' + plan.selectedRoom + '-bath'));
  }
  for (const bedroom of bedrooms) {
    for (const type of ['bed', 'desk', 'chair']) {
      assert.equal(plan.items.filter(item => item.zone === bedroom.id && item.type === type).length, 1);
    }
  }
  for (const [index, item] of plan.items.entries()) {
    const zone = plan.zones.find(zone => zone.id === item.zone);
    assert.ok([item.x, item.z, item.w, item.d].every(Number.isFinite));
    assert.ok(item.w > 0 && item.d > 0);
    assert.ok(item.x >= zone.x + .099 && item.z >= zone.z + .099 &&
      item.x + item.w <= zone.x + zone.w - .099 &&
      item.z + item.d <= zone.z + zone.d - .099, item.zone + '/' + item.type + ' crosses its walls');
    for (const other of plan.items.slice(index + 1)) {
      assert.ok(!overlap(item, other, .039),
        item.zone + '/' + item.type + ' overlaps ' + other.zone + '/' + other.type);
    }
    for (const route of plan.routes) {
      const nestedBathroom = route.name === '套卫占地' && item.zone === route.zone + '-bath';
      if (!nestedBathroom) assert.ok(!overlap(item, route), item.type + ' blocks ' + route.name);
    }
  }
}

function checkWalkingAccess(plan) {
  const step = .1, radius = .275;
  const nx = Math.ceil(plan.width / step), nz = Math.ceil(plan.depth / step);
  const blocked = new Uint8Array(nx * nz);
  const walls = plan.walls.map(wall => wall.axis === 'x'
    ? {x: wall.start, z: wall.fixed - .055, w: wall.end - wall.start, d: .11}
    : {x: wall.fixed - .055, z: wall.start, w: .11, d: wall.end - wall.start});
  for (const rect of [...walls, ...plan.items]) {
    const minX = Math.max(0, Math.floor((rect.x - radius) / step));
    const maxX = Math.min(nx, Math.ceil((rect.x + rect.w + radius) / step));
    const minZ = Math.max(0, Math.floor((rect.z - radius) / step));
    const maxZ = Math.min(nz, Math.ceil((rect.z + rect.d + radius) / step));
    for (let iz = minZ; iz < maxZ; iz++) {
      for (let ix = minX; ix < maxX; ix++) {
        const x = (ix + .5) * step, z = (iz + .5) * step;
        const dx = Math.max(rect.x - x, 0, x - rect.x - rect.w);
        const dz = Math.max(rect.z - z, 0, z - rect.z - rect.d);
        if (dx * dx + dz * dz < radius * radius) blocked[iz * nx + ix] = 1;
      }
    }
  }
  const entry = plan.doors.find(door => door.zone === 'entry');
  const origin = Math.floor((plan.depth - .35) / step) * nx + Math.floor(entry.center / step);
  assert.equal(blocked[origin], 0, 'Blocked apartment entrance');
  const seen = new Uint8Array(nx * nz), queue = new Int32Array(nx * nz);
  let head = 0, tail = 1;
  seen[origin] = 1;
  queue[0] = origin;
  while (head < tail) {
    const current = queue[head++], ix = current % nx, iz = Math.floor(current / nx);
    for (const [x, z] of [[ix - 1, iz], [ix + 1, iz], [ix, iz - 1], [ix, iz + 1]]) {
      if (x < 0 || x >= nx || z < 0 || z >= nz) continue;
      const next = z * nx + x;
      if (blocked[next] || seen[next]) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  for (const item of plan.items) {
    if (!['bed', 'desk', 'wardrobe', 'clothesRack', 'basin', 'toilet', 'shower', 'fridge', 'kitchenCounter'].includes(item.type)) continue;
    const zone = plan.zones.find(zone => zone.id === item.zone);
    let reachable = false;
    for (let iz = Math.max(0, Math.floor((item.z - .55) / step)); iz < Math.min(nz, Math.ceil((item.z + item.d + .55) / step)); iz++) {
      for (let ix = Math.max(0, Math.floor((item.x - .55) / step)); ix < Math.min(nx, Math.ceil((item.x + item.w + .55) / step)); ix++) {
        if (!seen[iz * nx + ix]) continue;
        const x = (ix + .5) * step, z = (iz + .5) * step;
        if (x <= zone.x + .08 || x >= zone.x + zone.w - .08 || z <= zone.z + .08 || z >= zone.z + zone.d - .08) continue;
        const dx = Math.max(item.x - x, 0, x - item.x - item.w);
        const dz = Math.max(item.z - z, 0, z - item.z - item.d);
        if (dx * dx + dz * dz < .55 * .55) reachable = true;
      }
    }
    assert.ok(reachable, item.zone + '/' + item.type + ' cannot be reached from the entrance');
  }
}

assert.equal(listings.length, 168);
for (const listing of listings) {
  const character = nestCharacter(listing);
  const plan = planInterior(listing, character);
  try {
    checkPlan(listing, plan);
    checkWalkingAccess(plan);
    assert.equal(JSON.stringify(plan), JSON.stringify(planInterior(listing, character)), 'Unstable layout');
    const model = interior(listing);
    assert.ok(model.faces.length > 0);
    for (const face of model.faces) {
      assert.ok(face.points.length >= 3);
      assert.ok(face.points.every(point => point.every(Number.isFinite)), 'Invalid rendered geometry');
    }
  } catch (error) {
    error.message = listing.key + ' ' + error.message;
    throw error;
  }
}

let variants = 0;
for (let rooms = 1; rooms <= 6; rooms++) {
  for (let baths = 1; baths <= 3; baths++) {
    for (const archetype of ['pair', 'row', 'lshape', 'corridor', 'double', 'wing', 'cluster']) {
      for (const allFeatures of [false, true]) {
        const listing = {...listings[0], key: 'edge-' + variants,
          layout: rooms + '室1厅' + baths + '卫', rooms,
          roomType: allFeatures ? '主卧·独卫' : '次卧'};
        const character = nestCharacter(listing);
        character.archetype = archetype;
        character.roomIndex = rooms - 1;
        character.features = Object.fromEntries(Object.keys(character.features).map(key => [key, allFeatures]));
        const plan = planInterior(listing, character);
        try {
          checkPlan(listing, plan);
          checkWalkingAccess(plan);
        } catch (error) {
          console.error('Variant', listing.layout, archetype, allFeatures);
          error.message = listing.layout + '/' + archetype + '/' + allFeatures + ' ' + error.message;
          throw error;
        }
        variants++;
      }
    }
  }
}
console.log('Passed 168 listing layouts and ' + variants +
  ' boundary variants: furniture collisions, room counts, door access, 55cm circulation probe, stable generation and finite rendered geometry.');
