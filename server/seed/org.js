'use strict';
// The real organisation: entities, markets, districts, the 51 active salons and company leadership.
// Source: the Dogwood store directory, less closed locations (8042, 8924, 82910, 82911, 82297, 82301, 82956),
// and the district assignments in data/productivity/salon.csv (report of 2026-11-10).
// Idempotent: safe to run again; existing rows are matched on their natural keys and left in place.

const ENTITIES = [
  ['SC-SoCal-31', 'Sc-SoCal-31, LLC'],
  ['SC-SoCal-3', 'Sc-SoCal-3, LLC'],
  ['SC-SD-6', 'Sc-SD-6, LLC'],
  ['SC-LV-14', 'Sc-Lv-14, LLC'],
  ['SC-LV-EE-1', 'Sc-Lv-EE-1, LLC'],
  ['SC-PHX-6', 'Sc-Phx-6, LLC'],
];

const MARKETS = [
  ['Inland Empire', 'CA'], ['San Gabriel Valley', 'CA'], ['High Desert', 'CA'], ['Westside LA', 'CA'],
  ['Orange County', 'CA'], ['Temecula Valley', 'CA'], ['Las Vegas', 'NV'], ['Phoenix', 'AZ'],
];

// District names are working labels (editable in Admin). Leaders are the real district leaders.
const DISTRICTS = [
  { key: 'karen', name: 'High Desert & Inland North', leader: ['Karen', 'Chacon'] },
  { key: 'brittney', name: 'Inland South & Temecula Valley', leader: ['Brittney', 'Garrett'] },
  { key: 'alana', name: 'Foothill & Pomona Valley', leader: ['Alana', 'Kaiaokamalie'] },
  { key: 'heather', name: 'Westside & San Gabriel', leader: ['Heather', 'Branson'] },
  { key: 'juana', name: 'Las Vegas East & Central', leader: ['Juana', 'Lucio'] },
  { key: 'sarah', name: 'Las Vegas North & West', leader: ['Sarah', 'Nakagawa'] },
  { key: 'kirsten', name: 'Phoenix', leader: ['Kirsten', 'Hepp'] },
];

// [salon_number, name, address, city, state, zip, shopping_center, phone, market, district key, entity, concept]
const S = 'SUPERCUTS';
const SALONS = [
  ['80660', 'Apple Valley', '12218 Apple Valley Rd Ste 303', 'Apple Valley', 'CA', '92308', 'Apple Valley Village', '760-240-8454', 'High Desert', 'karen', 'SC-SoCal-31', S],
  ['8768', 'Arcadia', '411 E Huntington Dr Ste 105', 'Arcadia', 'CA', '91006', 'Arcadia Landmark', '626-821-0820', 'San Gabriel Valley', 'heather', 'SC-SoCal-31', S],
  ['80642', 'Beaumont', '1668 E 2nd St Unit D', 'Beaumont', 'CA', '92223', 'Marketplace Beaumont', '951-769-4662', 'Inland Empire', 'brittney', 'SC-SoCal-31', S],
  ['8182', 'Chino', '12203 Central Ave', 'Chino', 'CA', '91710', 'Chino Town Center', '909-591-0881', 'Inland Empire', 'alana', 'SC-SoCal-31', S],
  ['81073', 'Chino Hills 2', '4200 Chino Hills Pkwy Ste 845', 'Chino Hills', 'CA', '91709', 'Chino Hills Marketplace', '909-597-5013', 'Inland Empire', 'alana', 'SC-SoCal-31', S],
  ['8179', 'Claremont', '926 W Foothill Blvd', 'Claremont', 'CA', '91711', 'Foothill Square', '909-625-6571', 'San Gabriel Valley', 'alana', 'SC-SoCal-31', S],
  ['81053', 'Corona Crossings', '2690 Tuscany St Ste D4-104', 'Corona', 'CA', '92881', 'Crossings at Corona', '951-279-1898', 'Inland Empire', 'brittney', 'SC-SoCal-31', S],
  ['81893', 'Corona Vista', '924 E Ontario Ave Ste 104', 'Corona', 'CA', '92881', null, '951-268-6452', 'Inland Empire', 'brittney', 'SC-SoCal-31', S],
  ['8030', 'Covina 1', '426 N Azusa Ave', 'Covina', 'CA', '91722', 'N Azusa & San Bernardino Rd', '626-966-7591', 'San Gabriel Valley', 'alana', 'SC-SoCal-31', S],
  ['80009', 'Covina 2', '984 E Badillo St Ste B', 'Covina', 'CA', '91724', 'Berkly Square', '626-966-3997', 'San Gabriel Valley', 'alana', 'SC-SoCal-31', S],
  ['80085', 'Duarte', '1010 Huntington Dr', 'Duarte', 'CA', '91010', 'Mountain Vista Plaza', '626-358-8112', 'San Gabriel Valley', 'heather', 'SC-SoCal-31', S],
  ['80359', 'Eastvale', '12672 Limonite Ave Ste 3B', 'Eastvale', 'CA', '92880', 'Cloverdale Marketplace', '951-898-0162', 'Inland Empire', 'brittney', 'SC-SoCal-31', S],
  ['8780', 'Hesperia', '15733 Main St', 'Hesperia', 'CA', '92345', 'Hesperia Town Center', '760-947-4247', 'High Desert', 'karen', 'SC-SoCal-31', S],
  ['80590', 'La Verne', '1612 Foothill Blvd', 'La Verne', 'CA', '91750', 'La Verne Commons Shopping Ctr', '909-593-5438', 'San Gabriel Valley', 'alana', 'SC-SoCal-31', S],
  ['8495', 'Marina Del Rey', '4371 Glencoe Ave', 'Marina Del Rey', 'CA', '90292', 'Villa Marina Center', '310-827-0138', 'Westside LA', 'heather', 'SC-SoCal-31', S],
  ['8896', 'Montclair', '9051 Central Ave', 'Montclair', 'CA', '91763', 'Montclair Promenade', '909-621-6936', 'Inland Empire', 'alana', 'SC-SoCal-31', S],
  ['80644', 'MV Stoneridge', '27120 Eucalyptus Blvd', 'Moreno Valley', 'CA', '92555', 'Stoneridge Towne Center', '951-485-2414', 'Inland Empire', 'brittney', 'SC-SoCal-31', S],
  ['81119', 'Moreno Valley', '12510 Day St Ste A1', 'Moreno Valley', 'CA', '92553', 'Town Gate Crossing', '951-653-5555', 'Inland Empire', 'brittney', 'SC-SoCal-31', S],
  ['80039', 'Pasadena', '1842 E Washington Blvd', 'Pasadena', 'CA', '91104', 'Allen & Washington', '626-398-0588', 'San Gabriel Valley', 'heather', 'SC-SoCal-31', S],
  ['80143', 'Rancho 2', '12273 Highland Ave Ste 134', 'Rancho Cucamonga', 'CA', '91739', 'DayCreek Village', '909-463-2910', 'Inland Empire', 'karen', 'SC-SoCal-31', S],
  ['8778', 'Riverside 2', '6131 Magnolia Ave', 'Riverside', 'CA', '92506', 'Magnolia Town Center', '951-781-9226', 'Inland Empire', 'alana', 'SC-SoCal-31', S],
  ['8048', 'San Bernardino', '525 E Hospitality Ln Ste B', 'San Bernardino', 'CA', '92408', 'Tri City Center', '909-890-2530', 'Inland Empire', 'karen', 'SC-SoCal-31', S],
  ['8129', 'San Dimas', '1383 W Arrow Hwy', 'San Dimas', 'CA', '91773', 'San Dimas Arrow Plaza', '909-599-3922', 'San Gabriel Valley', 'alana', 'SC-SoCal-31', S],
  ['8052', 'Santa Monica', '1828 Wilshire Blvd', 'Santa Monica', 'CA', '90403', null, '310-829-6729', 'Westside LA', 'heather', 'SC-SoCal-31', S],
  ['80459', 'Upland', '1902 N Campus Ave Ste F', 'Upland', 'CA', '91784', 'Colonies at Crossroad', '909-920-6014', 'Inland Empire', 'alana', 'SC-SoCal-31', S],
  ['8571', 'Victorville 1', '15667 Roy Rogers Dr Ste 109', 'Victorville', 'CA', '92394', 'Desert Sky Plaza', '760-241-9090', 'High Desert', 'karen', 'SC-SoCal-31', S],
  ['8348', 'Victorville 2', '14329 Bear Valley Rd Ste 3', 'Victorville', 'CA', '92392', 'Dunia Plaza', '760-949-5524', 'High Desert', 'karen', 'SC-SoCal-31', S],
  ['81106', 'Marina Village', '5942 E Edinger Ave Ste 105', 'Huntington Beach', 'CA', '92649', 'Marina Village', '714-846-3464', 'Orange County', 'heather', 'SC-SoCal-3', S],
  ['82436', 'Menifee', '30120 Haun Rd Ste 410', 'Menifee', 'CA', '92584', 'Countryside Marketplace', '951-301-9321', 'Temecula Valley', 'brittney', 'SC-SD-6', S],
  ['82437', 'Murrieta', '41024 California Oaks Dr Ste B12', 'Murrieta', 'CA', '92562', 'Cal Oaks Plaza', '951-677-8977', 'Temecula Valley', 'brittney', 'SC-SD-6', S],
  ['82438', 'Temecula', '31950 Temecula Pkwy', 'Temecula', 'CA', '92592', 'Temecula Parkway', '951-302-7775', 'Temecula Valley', 'brittney', 'SC-SD-6', S],
  ['82439', 'Temecula Rancho', '30590 Rancho California Rd', 'Temecula', 'CA', '92591', 'Rancho California', '951-695-1858', 'Temecula Valley', 'brittney', 'SC-SD-6', S],
  ['82298', 'Sahara Square', '2620 S Maryland Pkwy Ste 15', 'Las Vegas', 'NV', '89109', 'Sahara Towne Square', '702-732-0040', 'Las Vegas', 'juana', 'SC-LV-14', S],
  ['82302', 'Sunrise', '6895 E Lake Mead Blvd Ste 4', 'Las Vegas', 'NV', '89156', 'Sunrise Plaza', '702-453-5079', 'Las Vegas', 'juana', 'SC-LV-14', S],
  ['82303', 'Charleston Commons', '135 N Nellis Blvd', 'Las Vegas', 'NV', '89110', 'Charleston Commons', '702-452-6404', 'Las Vegas', 'juana', 'SC-LV-14', S],
  ['82908', 'Westland', '1291 S Decatur Blvd Ste 160', 'Las Vegas', 'NV', '89102', 'Westland Fair', '702-259-4961', 'Las Vegas', 'juana', 'SC-LV-14', S],
  ['82909', 'Hualapai', '9811 W Charleston Blvd Ste 3', 'Las Vegas', 'NV', '89117', 'Hualapai Commons', '702-947-7755', 'Las Vegas', 'sarah', 'SC-LV-14', S],
  ['83335', 'Siena', '10170 W Tropicana Ave Ste 159', 'Las Vegas', 'NV', '89147', 'Siena Town Center', '702-362-6366', 'Las Vegas', 'sarah', 'SC-LV-14', S],
  ['83336', 'Grand Canyon', '4205 S Grand Canyon Dr Ste 5', 'Las Vegas', 'NV', '89147', 'Grand Canyon Parkway', '702-362-4040', 'Las Vegas', 'juana', 'SC-LV-14', S],
  ['83337', 'Centennial', '7920 W Tropical Pkwy Ste 140', 'Las Vegas', 'NV', '89149', 'Centennial Center', '702-515-0471', 'Las Vegas', 'sarah', 'SC-LV-14', S],
  ['83338', 'Rio Vista Plaza', '7065 W Ann Rd Ste 140', 'Las Vegas', 'NV', '89130', 'Rio Vista Plaza', '702-396-4542', 'Las Vegas', 'sarah', 'SC-LV-14', S],
  ['83339', 'Durango', '7785 N Durango Rd Ste 145', 'Las Vegas', 'NV', '89131', 'Durango Square', '702-395-9716', 'Las Vegas', 'sarah', 'SC-LV-14', S],
  ['82142', 'Decatur Rice', '6150 N Decatur Blvd Ste 104', 'North Las Vegas', 'NV', '89031', 'Decatur Rice Center', '702-485-3555', 'Las Vegas', 'sarah', 'SC-LV-EE-1', S],
  ['82614', 'Parkway', '7575 W Washington Blvd Ste 119', 'Las Vegas', 'NV', '89128', null, '702-228-2146', 'Las Vegas', 'sarah', 'SC-LV-EE-1', S],
  ['82747', 'Flamingo', '4011 S Buffalo Dr Ste 103B', 'Las Vegas', 'NV', '89147', 'Flamingo Buffalo Center', '702-871-7676', 'Las Vegas', 'juana', 'SC-LV-EE-1', S],
  ['82924', 'Vista Commons', '11700 W Charleston Blvd Ste 130', 'Las Vegas', 'NV', '89135', 'Vista Commons Shopping Center', '702-888-1151', 'Las Vegas', 'juana', 'SC-LV-EE-1', S],
  ['82958', 'North Valley', '8085 W Bell Rd', 'Peoria', 'AZ', '85382', 'North Valley Power Center', '623-486-2176', 'Phoenix', 'kirsten', 'SC-PHX-6', S],
  ['81658', 'Deer Valley', '2805 W Agua Fria Fwy Ste 2B', 'Phoenix', 'AZ', '85027', 'Deer Valley Towne Center', '623-434-8400', 'Phoenix', 'kirsten', 'SC-PHX-6', S],
  ['18828', 'SmartStyle South Mountain', '6131 E Southern Ave', 'Phoenix', 'AZ', '85042', 'Marketplace at South Mountain (Walmart)', '602-268-0558', 'Phoenix', 'kirsten', 'SC-PHX-6', 'SMARTSTYLE'],
  ['82953', 'Town & Country', '2037 E Camelback Rd', 'Phoenix', 'AZ', '85016', 'Town & Country Center', '602-955-1760', 'Phoenix', 'kirsten', 'SC-PHX-6', S],
  ['82954', 'Ahwatukee', '4722 E Ray Rd Ste 16', 'Phoenix', 'AZ', '85044', 'Ahwatukee Foothills Towne Ctr', '480-893-3738', 'Phoenix', 'kirsten', 'SC-PHX-6', S],
];

// Approximate city centres, for the map. Replace with surveyed coordinates when available.
const CITY_COORDS = {
  'Apple Valley': [34.5008, -117.1859], Arcadia: [34.1397, -118.0353], Beaumont: [33.9295, -116.9772], Chino: [34.0122, -117.6889],
  'Chino Hills': [33.9898, -117.7326], Claremont: [34.0967, -117.7198], Corona: [33.8753, -117.5664], Covina: [34.09, -117.8903],
  Duarte: [34.1395, -117.9773], Eastvale: [33.9525, -117.5848], Hesperia: [34.4264, -117.3009], 'La Verne': [34.1008, -117.7678],
  'Marina Del Rey': [33.9803, -118.4517], Montclair: [34.0775, -117.6898], 'Moreno Valley': [33.9425, -117.2297], Pasadena: [34.1478, -118.1445],
  'Rancho Cucamonga': [34.1064, -117.5931], Riverside: [33.9533, -117.3962], 'San Bernardino': [34.1083, -117.2898], 'San Dimas': [34.1067, -117.8067],
  'Santa Monica': [34.0195, -118.4912], Upland: [34.0975, -117.6484], Victorville: [34.5362, -117.2928], 'Huntington Beach': [33.6603, -117.9992],
  Menifee: [33.6971, -117.1853], Murrieta: [33.5539, -117.2139], Temecula: [33.4936, -117.1484], 'Las Vegas': [36.1699, -115.1398],
  'North Las Vegas': [36.1989, -115.1175], Peoria: [33.5806, -112.2374], Phoenix: [33.4484, -112.074],
};

// Placeholder trading hours until each salon's real hours are entered in Admin.
const DEFAULT_HOURS = { mon: '9:00 AM – 8:00 PM', tue: '9:00 AM – 8:00 PM', wed: '9:00 AM – 8:00 PM', thu: '9:00 AM – 8:00 PM', fri: '9:00 AM – 8:00 PM', sat: '9:00 AM – 7:00 PM', sun: '10:00 AM – 6:00 PM' };

// [username, first, last, role, title, email]
const LEADERSHIP = [
  ['faisal', 'Faisal', 'Charania', 'executive', 'Founder & CEO', null],
  ['chris', 'Chris', 'Larkins', 'executive', 'CEO, Portfolio Companies', null],
  ['zemar', 'Zemar', 'Motani', 'admin', 'EVP / Director of Operations', null],
  ['samantha', 'Samantha', 'Graziano', 'hr', 'HR & Payroll', null],
  ['emory', 'Emory', 'Smith', 'admin', 'Technology & Analytics', null],
];

const DISABLED_HASH = '!disabled'; // cannot be matched by any password; an admin issues a real one with "Reset password"

/**
 * Loads the organisation. `passwordFor(username)` returns a password hash for the leadership logins
 * (or null to leave the account without a usable password).
 */
function seedOrg(db, { passwordFor = () => null, now = new Date().toISOString() } = {}) {
  const out = { salons: 0, leadership: [], districtLeaders: [] };
  db.transaction(() => {
    const insEntity = db.prepare('INSERT OR IGNORE INTO entities (code, legal_name) VALUES (?, ?)');
    for (const e of ENTITIES) insEntity.run(...e);
    const insMarket = db.prepare('INSERT OR IGNORE INTO markets (name, state) VALUES (?, ?)');
    for (const m of MARKETS) insMarket.run(...m);
    const insDistrict = db.prepare('INSERT OR IGNORE INTO districts (name) VALUES (?)');
    for (const d of DISTRICTS) insDistrict.run(d.name);

    const entityId = new Map(db.prepare('SELECT id, code FROM entities').all().map((x) => [x.code, x.id]));
    const marketId = new Map(db.prepare('SELECT id, name FROM markets').all().map((x) => [x.name, x.id]));
    const districtId = new Map(DISTRICTS.map((d) => [d.key, db.prepare('SELECT id FROM districts WHERE name = ?').get(d.name).id]));

    const findUser = db.prepare('SELECT id FROM users WHERE username = ?');
    const insUser = db.prepare(`INSERT INTO users (email, username, password_hash, must_change_password, role, first_name, last_name, title, district_id, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?, 'active', ?)`);

    for (const [username, first, last, role, title, email] of LEADERSHIP) {
      let row = findUser.get(username);
      if (!row) {
        const hash = passwordFor(username);
        const info = insUser.run(email, username, hash || DISABLED_HASH, hash ? 1 : 0, role, first, last, title, null, now);
        row = { id: Number(info.lastInsertRowid) };
      }
      out.leadership.push({ username, id: row.id });
    }
    for (const d of DISTRICTS) {
      const username = `${d.leader[0]}.${d.leader[1]}`.toLowerCase();
      let row = findUser.get(username);
      if (!row) {
        const info = insUser.run(null, username, DISABLED_HASH, 0, 'district_leader', d.leader[0], d.leader[1], 'District Leader', districtId.get(d.key), now);
        row = { id: Number(info.lastInsertRowid) };
      }
      db.prepare('UPDATE districts SET leader_user_id = COALESCE(leader_user_id, ?) WHERE id = ?').run(row.id, districtId.get(d.key));
      out.districtLeaders.push({ username, id: row.id, district_id: districtId.get(d.key) });
    }

    const insSalon = db.prepare(`INSERT OR IGNORE INTO salons (salon_number, name, concept, address, city, state, zip, phone, shopping_center, market_id, district_id, entity_id, hours_json, lat, lng, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active')`);
    for (const [num, name, address, city, state, zip, center, phone, market, dkey, entity, concept] of SALONS) {
      const [lat, lng] = CITY_COORDS[city] || [null, null];
      out.salons += insSalon.run(num, name, concept, address, city, state, zip, phone, center, marketId.get(market), districtId.get(dkey), entityId.get(entity), JSON.stringify(DEFAULT_HOURS), lat, lng).changes;
    }
    // Stock photos until real storefront photos are uploaded (SPEC section 10).
    db.prepare("UPDATE salons SET photo_url = '/media/salon-' || (1 + id % 6) || '.webp' WHERE photo_url IS NULL").run();
  })();
  return out;
}

module.exports = { seedOrg, ENTITIES, MARKETS, DISTRICTS, SALONS, LEADERSHIP, DISABLED_HASH };
