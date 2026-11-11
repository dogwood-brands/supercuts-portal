'use strict';
// Sample people, activity and KPIs for the preview. Everything here is invented:
// names are not real employees and no figure is copied from company records.
// A seeded generator keeps the people and the shape of the numbers the same on every run.
const fs = require('node:fs');
const path = require('node:path');
const { addDays, todayLocal, weekday, daysInMonth } = require('../util');

// ---- deterministic randomness ---------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const r = mulberry32(seed);
  const api = {
    next: r,
    between: (lo, hi) => lo + r() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + r() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(r() * xs.length)],
    chance: (p) => r() < p,
    shuffle: (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    sample: (xs, n) => api.shuffle(xs).slice(0, n),
  };
  return api;
}

const FIRST = ['Maria', 'Jessica', 'Ashley', 'Brianna', 'Destiny', 'Alejandra', 'Vanessa', 'Crystal', 'Monique', 'Tiffany', 'Jasmine', 'Karina', 'Stephanie', 'Angela', 'Nicole',
  'Priya', 'Mei', 'Linh', 'Thuy', 'Grace', 'Hannah', 'Leilani', 'Kiana', 'Aaliyah', 'Imani', 'Tanisha', 'Rosa', 'Guadalupe', 'Yesenia', 'Daniela', 'Marisol', 'Paola', 'Fatima',
  'Layla', 'Sofia', 'Camila', 'Valeria', 'Natalie', 'Megan', 'Kayla', 'Amber', 'Brooke', 'Taylor', 'Jordan', 'Morgan', 'Erika', 'Bianca', 'Selena', 'Noemi', 'Ivette',
  'Marcus', 'Anthony', 'Luis', 'Carlos', 'Miguel', 'Andre', 'Darnell', 'Kevin', 'Brandon', 'Tyler', 'Minh', 'Jason', 'Omar', 'Rafael', 'Isaiah', 'Devon', 'Trevor', 'Jesse', 'Adrian', 'Eli'];
const LAST = ['Garcia', 'Martinez', 'Lopez', 'Hernandez', 'Gonzalez', 'Rodriguez', 'Perez', 'Sanchez', 'Ramirez', 'Torres', 'Flores', 'Rivera', 'Gomez', 'Diaz', 'Reyes', 'Morales',
  'Cruz', 'Ortiz', 'Gutierrez', 'Chavez', 'Ramos', 'Mendoza', 'Castillo', 'Vargas', 'Nguyen', 'Tran', 'Pham', 'Le', 'Kim', 'Park', 'Chen', 'Wong', 'Patel', 'Singh', 'Johnson',
  'Williams', 'Brown', 'Jones', 'Davis', 'Miller', 'Wilson', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
  'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Carter', 'Mitchell', 'Campbell', 'Roberts', 'Phillips', 'Evans', 'Turner', 'Parker', 'Collins', 'Edwards', 'Stewart', 'Morris',
  'Salazar', 'Estrada', 'Aguilar', 'Vega', 'Soto', 'Delgado', 'Navarro', 'Santos', 'Kealoha', 'Tanaka'];

const DEFAULT_VALUES = [
  { key: 'guest_first', label: 'Guest first' },
  { key: 'team_player', label: 'Team player' },
  { key: 'craft', label: 'Craft' },
  { key: 'owns_it', label: 'Owns it' },
  { key: 'grows_others', label: 'Grows others' },
];

const DEFAULT_CHECKLISTS = [
  { key: 'open', name: 'Opening checklist', items: ['Lights, music and open sign on', 'Stations wiped down and stocked', 'Clean capes and towels at every chair', 'Tools sanitised and Barbicide refreshed',
    'Retail shelves fronted and dusted', 'Register opened and cash drawer counted', 'Check-in screen and online queue running', 'Restroom checked and stocked', 'Front windows and door glass clean'] },
  { key: 'close', name: 'Closing checklist', items: ['Floors swept and mopped, hair bins emptied', 'Stations cleaned and tools sanitised', 'Towels and capes in the wash', 'Shampoo bowls rinsed and wiped',
    'Cash drawer counted and deposit prepared', 'End-of-day report run', 'Trash out, back door locked', 'Retail restocked for the morning', 'Lights, music and sign off, alarm set'] },
  { key: 'weekly', name: 'Weekly deep clean and inventory', items: ['Deep clean shampoo area and drains', 'Dust vents, ledges and light fixtures', 'Wipe down chairs, bases and mirrors edge to edge',
    'Retail count against the order guide', 'Back bar and supplies count', 'Check first-aid kit and required postings', 'Review next week\'s schedule with the team'] },
];

// ---- content files (owned by the content agent). Shapes are read tolerantly. ----
function readContent(name) {
  const file = path.join(__dirname, '..', '..', 'content', name);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data)) return data;
    for (const k of ['items', name.replace('.json', ''), 'data']) if (Array.isArray(data?.[k])) return data[k];
    return null;
  } catch (e) {
    console.warn(`[seed] content/${name} could not be read (${e.message}); using the built-in set.`);
    return null;
  }
}
/** Accepts an absolute date or an offset in days from today (e.g. starts_in_days: -3). */
const relDate = (row, key, today) => {
  if (typeof row[key] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row[key])) return row[key].slice(0, 10);
  const off = row[`${key.replace('_on', '')}_in_days`] ?? row[`${key}_offset_days`];
  return Number.isFinite(off) ? addDays(today, off) : null;
};
const str = (x, max) => (x === null || x === undefined ? null : String(x).slice(0, max));

function seedContent(db, today, now, rng) {
  const counts = {};
  // Values
  const values = (readContent('values.json') || DEFAULT_VALUES).filter((x) => x && x.key && x.label).map((x) => ({ key: String(x.key).slice(0, 40), label: String(x.label).slice(0, 60), ...(x.meaning ? { meaning: String(x.meaning).slice(0, 200) } : {}) }));
  const setSetting = db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json');
  setSetting.run('values', JSON.stringify(values.length ? values : DEFAULT_VALUES));
  setSetting.run('company_name', JSON.stringify('SC Portal'));
  setSetting.run('sample_data', JSON.stringify(true));
  setSetting.run('academy_url', JSON.stringify('https://academy.dogwoodbrands.com'));

  // Checklists
  const insT = db.prepare('INSERT OR IGNORE INTO checklist_templates (key, name, items_json, active) VALUES (?,?,?,1)');
  for (const c of readContent('checklists.json') || DEFAULT_CHECKLISTS) {
    if (!c?.key || !Array.isArray(c.items)) continue;
    const items = c.items.map((it, i) => (typeof it === 'string' ? { id: `i${i + 1}`, label: it } : { id: String(it.id ?? `i${i + 1}`), label: String(it.label ?? '') })).filter((it) => it.label);
    insT.run(String(c.key), str(c.name || c.key, 80), JSON.stringify(items));
  }

  // Promos
  const promos = readContent('promos.json') || [
    { title: 'Holiday gift cards: buy $50, get a $10 bonus card', summary: 'Our biggest gift card push of the year. Offer every guest at checkout.', tag: 'Gift cards', starts_in_days: -10, ends_in_days: 44,
      body: 'Offer at every checkout through the holidays.\n\nHow to say it: "Are you shopping for anyone this season? Our gift cards come with a $10 bonus card right now."\n\nBonus cards are valid in January and February. Ring the gift card first so the bonus prints.' },
    { title: 'Take-home product: 2 for $30', summary: 'Mix and match on select styling and care products.', tag: 'Retail', starts_in_days: -3, ends_in_days: 25,
      body: 'Recommend what you used during the service. Guests are far more likely to buy the product they just watched you use.' },
    { title: 'Back to basics: rebook at checkout', summary: 'Every guest leaves with their next visit on the calendar.', tag: 'Guest experience', starts_in_days: -20, ends_in_days: 40,
      body: 'Ask before you take payment: "Most guests come back in four to five weeks to keep this shape. Want me to hold a spot?"' },
    { title: 'New year colour refresh', summary: 'January colour event. Details and pricing to come.', tag: 'Colour', starts_in_days: 51, ends_in_days: 82, body: 'Training and point-of-sale materials arrive the last week of December.' },
  ];
  const insP = db.prepare('INSERT INTO promos (title, summary, body, image_url, starts_on, ends_on, tag, audience, status, sort) VALUES (?,?,?,?,?,?,?,?,?,?)');
  counts.promos = 0;
  promos.forEach((p, i) => {
    if (!p?.title) return;
    insP.run(str(p.title, 140), str(p.summary, 400), str(p.body, 20000), str(p.image_url, 500), relDate(p, 'starts_on', today), relDate(p, 'ends_on', today),
      str(p.tag, 40), str(p.audience || 'all', 40), ['draft', 'archived'].includes(p.status) ? p.status : 'published', Number.isInteger(p.sort) ? p.sort : i);
    counts.promos += 1;
  });

  // Resources
  const resources = readContent('resources.json') || [
    { section: 'brand', category: 'Guest experience', title: 'The five-step guest experience', summary: 'Greet, consult, deliver, recommend, rebook.', requires_ack: true,
      body_md: '## Every guest, every time\n\n1. **Greet** within ten seconds and use their name.\n2. **Consult** before the cape goes on. Repeat back what you heard.\n3. **Deliver** the cut they asked for and show them the back.\n4. **Recommend** the product you used.\n5. **Rebook** before they pay.' },
    { section: 'brand', category: 'Appearance', title: 'Salon appearance standards', summary: 'What the salon looks like when it is ready for guests.',
      body_md: '## Ready for guests\n\n- Floors swept between every guest\n- Stations clear of personal items\n- Retail fronted, priced and dusted\n- Music at conversation level\n- Windows free of handwritten signs' },
    { section: 'brand', category: 'Appearance', title: 'Dress code', summary: 'Black, clean and professional.', requires_ack: true,
      body_md: '## Dress code\n\nBlack or dark tops and bottoms, closed-toe shoes, name tag on the left. Hair styled: we are our own best advertising.' },
    { section: 'products', category: 'Styling', title: 'Matching product to hair type', summary: 'A quick guide to recommending with confidence.',
      body_md: '## Recommend what you used\n\n| Hair | Reach for |\n|---|---|\n| Fine, flat | Light volumising foam |\n| Thick, coarse | Cream or pomade |\n| Curly | Leave-in and a curl cream |\n| Short and textured | Matte clay or paste |' },
    { section: 'policies', category: 'Conduct', title: 'Respect in the workplace', summary: 'How we treat each other and our guests.', requires_ack: true,
      body_md: '## Respect in the workplace\n\nEveryone on the team is treated with respect. Concerns can be raised with your manager, your district leader, or privately through **My Job → Ask HR**.' },
    { section: 'policies', category: 'Time', title: 'Timekeeping and meal breaks', summary: 'Clock in, clock out, and take your breaks.', requires_ack: true,
      body_md: '## Timekeeping\n\nClock in when you start working and out when you stop. Take your meal and rest breaks. If a punch is missed, tell your manager the same day.' },
    { section: 'ops', category: 'Cash', title: 'Cash handling and deposits', summary: 'Counting the drawer and making the deposit.',
      body_md: '## Cash handling\n\nCount the drawer at open and close with a second person where possible. Deposits go to the bank the next business morning.' },
    { section: 'ops', category: 'Safety', title: 'Sanitation and tool disinfection', summary: 'State board basics, every guest.',
      body_md: '## Sanitation\n\nDisinfect combs, guards and shears after every guest. Change disinfectant daily and log it on the opening checklist.' },
    { section: 'hr', category: 'Benefits', title: 'Benefits at a glance', summary: 'What is available and when you are eligible.',
      body_md: '## Benefits\n\nAsk HR through **My Job → Ask HR** for your eligibility dates and enrolment forms.' },
  ];
  const insR = db.prepare('INSERT INTO resources (section, category, title, summary, body_md, file_url, image_url, sort, requires_ack, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  counts.resources = 0;
  resources.forEach((r, i) => {
    if (!r?.title || !['brand', 'products', 'policies', 'ops', 'hr'].includes(r.section)) return;
    insR.run(r.section, str(r.category, 60), str(r.title, 140), str(r.summary, 400), str(r.body_md ?? r.body, 60000), str(r.file_url, 500), str(r.image_url, 500),
      Number.isInteger(r.sort) ? r.sort : i, r.requires_ack ? 1 : 0, now);
    counts.resources += 1;
  });

  // Videos
  const videos = readContent('videos.json') || [
    { channel: 'Guest experience', title: 'The guest consultation', description: 'How a great consultation sets up a great cut.', url: 'https://academy.dogwoodbrands.com', duration_s: 76 },
    { channel: 'Sales', title: 'Positioning products and services', description: 'Recommending without the hard sell.', url: 'https://academy.dogwoodbrands.com', duration_s: 148 },
    { channel: 'Operations', title: 'Point of sale and cash handling', description: 'Opening, closing and everything between.', url: 'https://academy.dogwoodbrands.com', duration_s: 132 },
  ];
  const insV = db.prepare('INSERT INTO videos (channel, title, description, url, poster_url, duration_s, views, sort) VALUES (?,?,?,?,?,?,?,?)');
  counts.videos = 0;
  videos.forEach((x, i) => {
    if (!x?.title || !x?.url) return;
    insV.run(str(x.channel || 'General', 60), str(x.title, 140), str(x.description, 2000), str(x.url, 500), str(x.poster_url, 500),
      Number.isInteger(x.duration_s) ? x.duration_s : null, Number.isInteger(x.views) ? x.views : rng.int(18, 240), Number.isInteger(x.sort) ? x.sort : i);
    counts.videos += 1;
  });

  // Events
  const events = readContent('events.json') || [
    { title: 'Holiday gift card promotion starts', starts_in_days: -10, kind: 'promo' },
    { title: 'Monthly retail count due', starts_in_days: 4, kind: 'deadline' },
    { title: 'District leader salon visits', starts_in_days: 6, ends_in_days: 10, kind: 'visit' },
    { title: 'Schedules for Thanksgiving week due', starts_in_days: 2, kind: 'deadline' },
    { title: 'Thanksgiving: salons closed', starts_in_days: 15, kind: 'holiday' },
    { title: 'Black Friday: extended hours', starts_in_days: 16, kind: 'hours' },
    { title: 'Stylist skills night: fades and tapers', starts_in_days: 12, kind: 'training' },
    { title: 'Payroll closes', starts_in_days: 9, kind: 'deadline' },
    { title: 'Managers call', starts_in_days: 7, kind: 'meeting' },
    { title: 'December goals published', starts_in_days: 19, kind: 'deadline' },
  ];
  const insE = db.prepare('INSERT INTO events (title, starts_on, ends_on, kind, audience_type, audience_id) VALUES (?,?,?,?,?,?)');
  counts.events = 0;
  for (const e of events) {
    const start = relDate(e, 'starts_on', today);
    if (!e?.title || !start) continue;
    insE.run(str(e.title, 140), start, relDate(e, 'ends_on', today), str(e.kind || 'general', 30), 'company', null);
    counts.events += 1;
  }
  return { counts, values: values.length ? values : DEFAULT_VALUES };
}

// ---- feed copy ---------------------------------------------------------------
// {t} = the person or team being recognised, {s} = their salon.
const SHOUTOUTS = [
  ['guest_first', '{t} stayed twenty minutes past close for a dad and three kids who walked in at 7:58. All four left happy and he rebooked the whole family. That is how you build a book.'],
  ['guest_first', 'A guest came in nervous after a bad cut somewhere else. {t} took the time to really listen, fixed it, and she cried happy tears at the chair. Proud to work next to you.'],
  ['team_player', 'Huge thank you to {t} for covering my Saturday so I could make my daughter\'s recital. Did not even hesitate.'],
  ['craft', 'If you have not seen {t}\'s skin fades lately, come watch. Three guests asked for them by name this week.'],
  ['owns_it', '{t} noticed the retail wall was a mess on a slow Tuesday and just rebuilt the whole thing. Looks brand new. Nobody asked.'],
  ['grows_others', '{t} finished every course in the Academy this month and is already using the consultation steps. You can hear the difference.'],
  ['team_player', 'Shout-out to {t} for jumping on shampoo bowls and sweeping for everyone during the Saturday rush without being asked. That kept the wait under ten minutes.'],
  ['guest_first', '{t} remembered a regular\'s name, his kids\' names and how he likes his sideburns. He told me at the register that is why he drives past two other salons to come here.'],
  ['craft', 'That layered bob {t} did this afternoon was textbook. The guest took a selfie before she even left the chair.'],
  ['owns_it', '{t} caught a deposit that did not match, recounted, and found the missing slip before close. Thank you for caring about the details.'],
  ['team_player', 'New stylist first week nerves are real. {t} spent every slow minute coaching and it shows. Thank you for making people feel welcome.'],
  ['guest_first', 'A walk-in in a wheelchair needed a little extra room and time. {t} moved the station around, took it slow, and made him feel like a VIP.'],
  ['grows_others', '{t} asked me to watch a clipper-over-comb and give honest notes. That takes guts. The next one was noticeably cleaner.'],
  ['craft', 'Kids cuts are an art. {t} had a three-year-old laughing through his first haircut. Mum booked the next one on the spot.'],
  ['owns_it', 'The check-in screen froze at open. {t} had a paper list going in thirty seconds and nobody waited a minute longer than they should have.'],
  ['team_player', '{t} came in on a day off to help with inventory count. We finished in half the time.'],
  ['guest_first', 'Read our newest five-star review: it is all about {t}. "Best haircut I have had in years and she actually listened."'],
  ['craft', '{t} talked a guest through a colour correction plan honestly, including what we could not do in one visit. She booked all three appointments.'],
  ['owns_it', 'Opening checklist done and signed before 8:50 every day this week. Thank you {t} for setting the tone.'],
  ['grows_others', '{t} hit a personal best on take-home product this week by doing one simple thing: recommending what was actually used at the chair.'],
  ['team_player', 'Thank you {t} for translating for a guest who was struggling to explain what she wanted. She left smiling.'],
  ['guest_first', '{t} walked an older guest out to her car in the rain with an umbrella. Small thing. Big thing.'],
  ['craft', 'Beard trims are up and it is because of {t}. Every guest gets asked, every trim is sharp.'],
  ['owns_it', '{t} stayed calm with an upset guest, offered to fix it on the spot, and turned it into a rebook. Textbook recovery.'],
];
const TEAM_SHOUTOUTS = [
  ['team_player', 'Shout-out to the whole {t} team. Spotless salon, every station stocked, and the best energy I have walked into all month.'],
  ['owns_it', '{t} closed out the week with every opening and closing checklist signed. That is what consistency looks like.'],
  ['guest_first', '{t} had a line out the door Saturday and still kept the wait honest and the guests smiling. Proud of this team.'],
  ['grows_others', 'Everyone at {t} has completed the consultation course. First salon in the district to get there.'],
  ['craft', 'Three new five-star reviews for {t} this week, all mentioning the cut by name. Keep it up.'],
];
const WINS = [
  'Best Saturday we have had since summer. Thank you to everyone who stayed sharp through the rush.',
  'We sold out of the holiday gift card sleeves by Thursday. More are on the way. Keep asking at every checkout.',
  'Five rebooks before noon today. Asking before you take payment really does work.',
  'Our product wall is fully restocked and fronted. Come see it, it looks great.',
  'Zero missed punches this pay period for the whole team. Thank you all.',
  'Hit our week goal a day early. Lunch is on me Friday.',
  'Every guest today was greeted in under ten seconds. I timed it. Nice work, team.',
  'We passed our state board walk-through with no notes. That is all of you keeping stations clean every single day.',
  'Twelve new guests this week said they found us from a friend\'s recommendation. Word of mouth is the best marketing.',
  'First week with the new towel routine and we have not run short once.',
];
const POSTS = [
  'Does anyone have a spare set of #1.5 guards? Ours walked off. Happy to trade.',
  'Reminder that the back parking lot is being resurfaced Thursday. Park on the east side.',
  'Tip that worked for me this week: I show guests the back with the hand mirror before I take the cape off. They notice.',
  'Who is going to the skills night? I can drive three people from the east side.',
  'Slow morning trick: we practised consultations on each other for twenty minutes. Honestly helpful.',
  'Found a pair of sunglasses at station 3 yesterday. They are at the front desk.',
  'What is everyone using to keep clipper blades cool on back-to-back fades?',
  'Loving the new playlist. Guests have commented on it twice today.',
  'If you are covering a shift at another salon this week, check the schedule again. A couple of times moved.',
  'Good morning from the early crew. Coffee is on.',
  'Quick one: the holiday hours signs are in the manager\'s office. Please put yours up by Friday.',
  'Anyone have a good way to explain the difference between a taper and a fade to a guest? I keep fumbling it.',
  'We tried greeting every guest by name from the check-in list today. People really light up.',
  'The new capes are so much better. No more hair down the collar.',
  'Thank you to whoever restocked the neck strips. You are the real hero.',
];
const COMMENTS = ['Love this.', 'So deserved.', 'This made my morning.', 'Way to go!', 'That is what it is all about.', 'Yes! Well done.', 'Proud of you.', 'Goals.', 'This team is something else.',
  'Thank you for sharing this.', 'Incredible. Keep it up.', 'We see you!', 'Stealing this idea for our salon.', 'Congratulations, well earned.', 'Best news I have read all day.', 'Same here, it works.',
  'I can bring some over tomorrow.', 'Count me in.', 'Good tip, trying it today.', 'Nicely done, team.'];

const ALERTS = {
  people: ['Training', 'Performance acknowledgements', 'Policy acknowledgements', 'Missed punch', 'Next week\'s schedule', 'Licences on file'],
  store: ['Daily count', 'Bank deposit', 'Monthly retail count', 'Supply order', 'Guest feedback follow-up', 'Maintenance request'],
  initiative: ['Holiday gift cards at every checkout', 'Rebook before payment', 'Recommend the product you used'],
};

const TICKETS = [
  ['it', 'Check-in screen freezes after lunch', 'The front check-in tablet locks up most afternoons and needs a restart. Guests end up waiting at the desk.', 'high'],
  ['it', 'Receipt printer printing faint', 'Receipts are almost unreadable. We changed the roll and it did not help.', 'normal'],
  ['facilities', 'Shampoo bowl 2 draining slowly', 'Water backs up after about thirty seconds. We are down to one bowl during rushes.', 'high'],
  ['facilities', 'Light out above station 4', 'Ceiling light over station 4 is flickering and then goes dark. Hard to see detail work.', 'normal'],
  ['facilities', 'Front door closer slams', 'The door slams hard enough that guests jump. Needs adjusting before it breaks the glass.', 'normal'],
  ['supplies', 'Running low on neck strips and capes', 'We have about two days of neck strips left and are short three capes.', 'normal'],
  ['supplies', 'Need more holiday gift card sleeves', 'We are out of the holiday sleeves and still have five weeks of the promotion.', 'low'],
  ['marketing', 'Window poster faded', 'The poster in the front window has faded in the sun. Can we get a replacement?', 'low'],
  ['marketing', 'Google listing shows old hours', 'Our listing still shows last year\'s Sunday hours. A guest came by after we closed.', 'normal'],
  ['facilities', 'Air conditioning not keeping up', 'By mid-afternoon the salon is uncomfortably warm, especially near the dryers.', 'urgent'],
  ['it', 'Card reader declines chip cards', 'About one in five chip cards fails and we have to swipe. Tap works fine.', 'high'],
  ['supplies', 'Barbicide order did not arrive', 'Last week\'s order is missing the disinfectant. We have enough for about four days.', 'normal'],
];

const HR_INQUIRIES = [
  ['pay', 'Question about my last pay stub', 'My last stub looks short by about four hours from the Saturday I covered at another salon. Could someone take a look?'],
  ['schedule', 'Changing my availability in January', 'I start an evening class in January and would need to finish by 5 on Tuesdays and Thursdays. Who should I talk to about that?'],
  ['benefits', 'When am I eligible for benefits?', 'I passed my ninety days last month. How do I find out what I can enrol in?'],
  ['leave', 'Time off for a family wedding', 'I would like to take four days off in February for a family wedding out of state. What is the process?'],
  ['other', 'Updating my address', 'I moved last week. Where do I update my address so my tax forms go to the right place?'],
  ['pay', 'Direct deposit change', 'I opened a new bank account. How do I switch my direct deposit over?'],
];

// =============================================================================
function seedSample(db, { seed = 20261111, passwordFor = () => null, log = () => {} } = {}) {
  const rng = makeRng(seed);
  const today = todayLocal();
  const yesterday = addDays(today, -1);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  // A moment `daysAgo` days back at roughly `hour` o'clock Pacific, never in the future.
  const iso = (daysAgo, hour) => {
    const t = Date.parse(`${addDays(today, -daysAgo)}T00:00:00Z`) + (hour + 8) * 3600000 + rng.int(0, 3599) * 1000;
    return new Date(Math.min(t, nowMs - rng.int(2, 90) * 60000)).toISOString();
  };
  const summary = {};

  db.transaction(() => {
    const { values } = seedContent(db, today, now, rng);
    const salons = db.prepare("SELECT s.*, d.leader_user_id FROM salons s LEFT JOIN districts d ON d.id = s.district_id WHERE s.status = 'active' ORDER BY s.id").all();
    const mdr = salons.find((s) => s.salon_number === '8495');

    // ---- people -------------------------------------------------------------
    const usedNames = new Set();
    const usedUsernames = new Set(db.prepare('SELECT username FROM users').all().map((u) => u.username));
    const insUser = db.prepare(`INSERT INTO users (username, password_hash, must_change_password, role, first_name, last_name, title, salon_id, district_id, phone, hire_date, birthday_md, bio, status, last_login_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?, ?)`);
    function person(role, salon, { username = null, tenureYears = [0.2, 9] } = {}) {
      let first, last;
      do { first = rng.pick(FIRST); last = rng.pick(LAST); } while (usedNames.has(`${first} ${last}`));
      usedNames.add(`${first} ${last}`);
      let uname = username;
      if (!uname) {
        const base = `${first}.${last}`.toLowerCase();
        uname = base;
        for (let i = 2; usedUsernames.has(uname); i++) uname = `${base}${i}`;
      }
      usedUsernames.add(uname);
      const hire = addDays(today, -Math.round(rng.between(tenureYears[0], tenureYears[1]) * 365));
      const bday = `${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;
      const hash = passwordFor(uname);
      const lastLogin = rng.chance(0.62) ? iso(rng.int(0, 6), rng.int(8, 19)) : rng.chance(0.5) ? iso(rng.int(8, 25), 12) : null;
      const info = insUser.run(uname, hash || '!disabled', 0, role, first, last, role === 'salon_manager' ? 'Salon Manager' : rng.chance(0.2) ? 'Senior Stylist' : 'Stylist',
        salon.id, null, null, hire, bday, null, lastLogin, now);
      return { id: Number(info.lastInsertRowid), first, last, name: `${first} ${last}`, salon_id: salon.id, role, username: uname };
    }

    const team = new Map(); // salon id -> { manager, stylists }
    for (const s of salons) {
      const isMdr = mdr && s.id === mdr.id;
      const manager = person('salon_manager', s, { username: isMdr ? 'demo.manager' : null, tenureYears: [2, 12] });
      const n = rng.int(4, 7);
      const stylists = [];
      for (let i = 0; i < n; i++) stylists.push(person('stylist', s, { username: isMdr && i === 0 ? 'demo.stylist' : null }));
      db.prepare('UPDATE salons SET manager_user_id = ? WHERE id = ?').run(manager.id, s.id);
      team.set(s.id, { manager, stylists, all: [manager, ...stylists] });
    }
    // Make sure a couple of celebrations land in the next two weeks at the demo salon.
    if (mdr) {
      const t = team.get(mdr.id);
      db.prepare('UPDATE users SET birthday_md = ? WHERE id = ?').run(addDays(today, 3).slice(5), t.stylists[1].id);
      db.prepare('UPDATE users SET hire_date = ? WHERE id = ?').run(`${Number(today.slice(0, 4)) - 3}-${addDays(today, 6).slice(5)}`, t.stylists[2].id);
    }
    // Role-level demo logins that are not tied to a seeded person.
    const heather = db.prepare("SELECT id, district_id FROM users WHERE username = 'heather.branson'").get();
    const insDemo = db.prepare(`INSERT INTO users (username, password_hash, must_change_password, role, first_name, last_name, title, district_id, status, created_at)
      VALUES (?,?,0,?,?,?,?,?, 'active', ?)`);
    const demo = {};
    for (const [uname, role, last, title, district] of [
      ['demo.admin', 'admin', 'Admin', 'Administrator (demo login)', null],
      ['demo.executive', 'executive', 'Executive', 'Leadership (demo login)', null],
      ['demo.hr', 'hr', 'HR', 'HR (demo login)', null],
      ['demo.dl', 'district_leader', 'District Leader', 'District Leader (demo login)', heather?.district_id || salons[0].district_id],
    ]) {
      if (usedUsernames.has(uname)) continue;
      const info = insDemo.run(uname, passwordFor(uname) || '!disabled', role, 'Demo', last, title, district, now);
      demo[uname] = Number(info.lastInsertRowid);
    }
    const people = [...team.values()].flatMap((t) => t.all);
    summary.people = people.length;

    // ---- KPIs: ~120 days through yesterday ----------------------------------
    const DAYS = 120;
    const WEEKDAY = [0.86, 0.8, 0.84, 0.9, 0.96, 1.16, 1.42]; // Sun..Sat
    const insK = db.prepare(`INSERT OR REPLACE INTO kpi_daily (salon_id, date, net_sales_c, service_c, product_c, guests, haircuts, hours, supercut_plus, source) VALUES (?,?,?,?,?,?,?,?,?, 'sample')`);
    const insSD = db.prepare('INSERT OR REPLACE INTO stylist_daily (user_id, date, service_c, product_c, guests, hours) VALUES (?,?,?,?,?,?)');
    const insGoal = db.prepare('INSERT OR REPLACE INTO kpi_goals (salon_id, period, sales_goal_c, product_pct_goal, srph_goal_c) VALUES (?,?,?,?,?)');
    const periods = [...new Set(Array.from({ length: DAYS }, (_, i) => addDays(yesterday, -i).slice(0, 7)))];

    for (const s of salons) {
      const r = makeRng(seed + Number(s.salon_number));
      const baseDaily = 620 + Math.pow(r.next(), 1.6) * 1500;      // invented scale, dollars per average day
      const atv = r.between(26.5, 33.5);
      const productShare = r.between(0.055, 0.125);
      const srph = r.between(43, 61);
      const plusRate = r.between(0.06, 0.2);
      const drift = r.between(-0.06, 0.09);                        // gentle trend over the window
      const members = team.get(s.id).all;
      const skill = new Map(members.map((m) => [m.id, r.between(0.75, 1.3)]));
      const retail = new Map(members.map((m) => [m.id, r.between(0.5, 1.6)]));
      const dayOff = new Map(members.map((m, i) => [m.id, [(i * 2) % 7, (i * 2 + 3) % 7]]));

      for (let i = DAYS - 1; i >= 0; i--) {
        const date = addDays(yesterday, -i);
        const wd = weekday(date);
        const trend = 1 + drift * (1 - i / DAYS);
        const net = Math.max(120, baseDaily * WEEKDAY[wd] * trend * r.between(0.86, 1.14));
        const guests = Math.max(4, Math.round(net / (atv * r.between(0.96, 1.04))));
        const product = net * productShare * r.between(0.7, 1.35);
        const service = net - product;
        const hours = service / (srph * r.between(0.92, 1.08));
        const netC = Math.round(net * 100);
        const productC = Math.round(product * 100);
        const serviceC = netC - productC;
        const hoursR = Math.round(hours * 100) / 100;
        insK.run(s.id, date, netC, serviceC, productC, guests, Math.round(guests * r.between(0.88, 0.96)), hoursR, Math.round(guests * plusRate * r.between(0.6, 1.4)));

        // Split the day across whoever worked, so the stylist lines add up to the salon exactly.
        let working = members.filter((m) => !dayOff.get(m.id).includes(wd));
        if (working.length < 2) working = members.slice(0, 2);
        const w = working.map((m) => skill.get(m.id) * r.between(0.8, 1.2));
        const wr = working.map((m, k) => w[k] * retail.get(m.id));
        const sumW = w.reduce((a, b) => a + b, 0);
        const sumWr = wr.reduce((a, b) => a + b, 0);
        let leftS = serviceC, leftP = productC, leftG = guests, leftH = Math.round(hoursR * 100);
        working.forEach((m, k) => {
          const lastOne = k === working.length - 1;
          const sc = lastOne ? leftS : Math.round((serviceC * w[k]) / sumW);
          const pc = lastOne ? leftP : Math.round((productC * wr[k]) / sumWr);
          const g = lastOne ? leftG : Math.min(leftG, Math.round((guests * w[k]) / sumW));
          const h = lastOne ? leftH : Math.round((hoursR * 100) / working.length);
          leftS -= sc; leftP -= pc; leftG -= g; leftH -= h;
          insSD.run(m.id, date, sc, pc, g, h / 100);
        });
      }
      // Goals: set against the salon's own run rate so pace lands between roughly 88% and 112%.
      for (const period of periods) {
        const stretch = r.between(0.9, 1.13);
        insGoal.run(s.id, period, Math.round((baseDaily * daysInMonth(period) * stretch) / 50) * 5000, r.chance(0.7) ? 9 : 8, Math.round(r.between(50, 54)) * 100);
      }
    }
    summary.kpi_days = DAYS;

    // ---- alerts -------------------------------------------------------------
    const insAlert = db.prepare('INSERT INTO alerts (salon_id, group_key, label, state, due_on, updated_at) VALUES (?,?,?,?,?,?)');
    for (const s of salons) {
      for (const [group, labels] of Object.entries(ALERTS)) {
        for (const label of labels) {
          const action = rng.chance(group === 'initiative' ? 0.3 : 0.22);
          insAlert.run(s.id, group, label, action ? 'action' : 'ok', action ? addDays(today, rng.int(0, 6)) : null, iso(rng.int(0, 2), 9));
        }
      }
    }

    // ---- checklist history ----------------------------------------------------
    const templates = db.prepare('SELECT * FROM checklist_templates WHERE active = 1').all();
    const insRun = db.prepare('INSERT OR IGNORE INTO checklist_runs (template_id, salon_id, date, done_json, completed_by, completed_at) VALUES (?,?,?,?,?,?)');
    for (const s of salons) {
      const discipline = rng.between(0.68, 1);
      const t = team.get(s.id);
      for (let i = 21; i >= 0; i--) {
        const date = addDays(today, -i);
        for (const tpl of templates) {
          const items = JSON.parse(tpl.items_json).map((x) => x.id);
          if (tpl.key === 'weekly' && weekday(date) !== 1) continue;
          if (i === 0) {
            // Today: opening is under way, closing has not started.
            if (tpl.key === 'open') insRun.run(tpl.id, s.id, date, JSON.stringify(items.slice(0, rng.int(Math.ceil(items.length / 2), items.length))), null, null);
            continue;
          }
          if (rng.chance(discipline)) insRun.run(tpl.id, s.id, date, JSON.stringify(items), t.manager.id, `${date}T${tpl.key === 'open' ? '16' : '04'}:${String(rng.int(10, 55))}:00.000Z`);
          else if (rng.chance(0.6)) insRun.run(tpl.id, s.id, date, JSON.stringify(items.slice(0, rng.int(2, items.length - 1))), null, null);
        }
      }
    }

    // ---- feed -----------------------------------------------------------------
    const insPost = db.prepare('INSERT INTO posts (author_id, kind, body, audience_type, audience_id, pinned_until, created_at) VALUES (?,?,?,?,?,?,?)');
    const insTarget = db.prepare('INSERT OR IGNORE INTO shoutout_targets (post_id, target_type, target_id, value_key) VALUES (?,?,?,?)');
    const insComment = db.prepare('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?,?,?,?)');
    const insReact = db.prepare('INSERT OR IGNORE INTO reactions (post_id, user_id, kind, created_at) VALUES (?,?,?,?)');
    const insRead = db.prepare('INSERT OR IGNORE INTO post_reads (post_id, user_id, read_at) VALUES (?,?,?)');
    const insNote = db.prepare('INSERT INTO notifications (user_id, kind, title, body, link, read_at, created_at) VALUES (?,?,?,?,?,?,?)');
    const valueKeys = new Set(values.map((x) => x.key));
    const valueOr = (k) => (valueKeys.has(k) ? k : values[0]?.key || null);
    const leaders = new Map(db.prepare("SELECT id, username, district_id FROM users WHERE role = 'district_leader' AND username NOT LIKE 'demo.%'").all().map((u) => [u.district_id, u]));
    const uid = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username)?.id;
    // The demo salon and its district get a little more activity so the preview logins have a lively feed.
    const weighted = salons.flatMap((s) => (mdr && s.id === mdr.id ? [s, s, s, s, s, s] : mdr && s.district_id === mdr.district_id ? [s, s] : [s]));
    const posts = [];
    function addPost({ author, kind, body, audience = ['company', null], daysAgo, hour, pinDays = 0, targets = [] }) {
      const created = iso(daysAgo, hour);
      const pinned = pinDays ? new Date(nowMs + pinDays * 86400000).toISOString() : null;
      const id = Number(insPost.run(author, kind, body, audience[0], audience[1], pinned, created).lastInsertRowid);
      for (const t of targets) insTarget.run(id, t.type, t.id, t.value || null);
      posts.push({ id, author, kind, created, audience, targets });
      return id;
    }

    // Announcements from leadership (generic, welcoming, safe to attribute).
    addPost({ author: uid('chris'), kind: 'announcement', daysAgo: 0, hour: 9, pinDays: 10,
      body: 'Welcome to the portal.\n\nThis is our front door for the field: your salon\'s numbers, promotions, brand standards, checklists, training and a direct line to HR, all in one place. Most of all it is where we recognise each other. If a teammate did something great today, give them a shout-out. I read every one.' });
    addPost({ author: uid('zemar'), kind: 'announcement', daysAgo: 1, hour: 10, pinDays: 7,
      body: 'Three things to do this week.\n\n1. Open My Job and acknowledge the policies waiting for you.\n2. Managers: sign off the opening and closing checklists each day.\n3. Give one shout-out. Tag the person and pick the value they showed.' });
    addPost({ author: uid('chris'), kind: 'announcement', daysAgo: 6, hour: 8,
      body: 'Holiday gift cards are live in every salon. Offer one at every checkout: guests who buy a $50 card get a $10 bonus card. Details and talking points are under Promos.' });
    addPost({ author: uid('faisal'), kind: 'announcement', daysAgo: 12, hour: 11,
      body: 'Thank you.\n\nI visited salons in three markets last week and saw the same thing in every one: stylists who care about the person in the chair. That is the whole business. Keep taking care of each other and of our guests.' });
    addPost({ author: uid('samantha'), kind: 'announcement', daysAgo: 4, hour: 13,
      body: 'Have a question about pay, schedule, benefits or time off? Use My Job → Ask HR. It comes straight to HR and stays private between you and us.' });
    for (const [districtId, leader] of leaders) {
      addPost({ author: leader.id, kind: 'announcement', audience: ['district', districtId], daysAgo: rng.int(2, 9), hour: rng.int(8, 11),
        body: rng.pick([
          'Thanksgiving week schedules are due in two days. Please post them where the team can see them and send me any gaps you need help covering.',
          'Salon visits next week. I will be looking at three things: the greeting, the consultation, and whether every guest is asked to rebook.',
          'Monthly retail count is due Friday. Count with a partner and double-check anything that is off by more than two units.',
        ]) });
    }
    // Salon announcements from managers.
    for (const s of rng.sample(salons, 9).concat(mdr ? [mdr] : [])) {
      addPost({ author: team.get(s.id).manager.id, kind: 'announcement', audience: ['salon', s.id], daysAgo: rng.int(0, 10), hour: rng.int(8, 12),
        body: rng.pick([
          'Team meeting Sunday at 9:30 before we open. Twenty minutes, coffee provided. We will walk through the holiday gift card offer.',
          'Next week\'s schedule is posted in the back. Text me by Wednesday if you need a swap.',
          'New towels and capes arrived. Old ones go in the grey bin, please do not mix them.',
          'Reminder: clock out for your meal break, every shift. Tell me the same day if you miss a punch.',
        ]) });
    }
    // Shout-outs to people.
    const lines = rng.shuffle(SHOUTOUTS);
    for (let i = 0; i < 38; i++) {
      const s = rng.pick(weighted);
      const t = team.get(s.id);
      const [value, text] = lines[i % lines.length];
      const fromManager = rng.chance(0.4);
      const author = fromManager ? t.manager : rng.pick(t.stylists);
      const target = rng.pick(t.stylists.filter((x) => x.id !== author.id));
      const fromLeader = rng.chance(0.12) && leaders.get(s.district_id);
      addPost({ author: fromLeader ? fromLeader.id : author.id, kind: 'shoutout', body: text.replaceAll('{t}', target.first).replaceAll('{s}', s.name),
        daysAgo: Math.floor(Math.pow(rng.next(), 1.4) * 20), hour: rng.int(8, 19), targets: [{ type: 'user', id: target.id, value: valueOr(value) }] });
    }
    // Shout-outs to whole salons.
    for (let i = 0; i < 9; i++) {
      const s = rng.pick(weighted);
      const [value, text] = TEAM_SHOUTOUTS[i % TEAM_SHOUTOUTS.length];
      const leader = leaders.get(s.district_id);
      addPost({ author: leader ? leader.id : team.get(s.id).manager.id, kind: 'shoutout', body: text.replaceAll('{t}', s.name), daysAgo: rng.int(0, 19), hour: rng.int(9, 17),
        targets: [{ type: 'salon', id: s.id, value: valueOr(value) }] });
    }
    // Wins and everyday posts.
    rng.shuffle(WINS).forEach((body) => {
      const s = rng.pick(weighted);
      addPost({ author: team.get(s.id).manager.id, kind: 'win', body, audience: rng.chance(0.5) ? ['salon', s.id] : ['company', null], daysAgo: rng.int(0, 20), hour: rng.int(9, 19) });
    });
    rng.shuffle(POSTS).forEach((body) => {
      const s = rng.pick(weighted);
      addPost({ author: rng.pick(team.get(s.id).all).id, kind: 'post', body, audience: rng.chance(0.55) ? ['salon', s.id] : ['company', null], daysAgo: rng.int(0, 20), hour: rng.int(8, 19) });
    });
    summary.posts = posts.length;

    // Reactions, comments, read receipts. Engagement comes from people who can see the post.
    const bySalon = (id) => team.get(id).all;
    const byDistrict = (id) => salons.filter((s) => s.district_id === id).flatMap((s) => bySalon(s.id));
    for (const p of posts) {
      const pool = p.audience[0] === 'salon' ? bySalon(p.audience[1]) : p.audience[0] === 'district' ? byDistrict(p.audience[1]) : people;
      const authorSalon = people.find((x) => x.id === p.author)?.salon_id;
      const near = authorSalon ? bySalon(authorSalon) : [];
      const reactors = new Set([...rng.sample(near, rng.int(1, Math.max(1, near.length - 1))), ...rng.sample(pool, rng.int(2, p.kind === 'announcement' ? 26 : 14))].map((x) => x.id));
      reactors.delete(p.author);
      const kinds = p.kind === 'shoutout' ? ['clap', 'clap', 'love', 'fire', 'like'] : p.kind === 'win' ? ['fire', 'clap', 'like', 'love'] : ['like', 'like', 'like', 'love', 'clap'];
      for (const id of reactors) insReact.run(p.id, id, rng.pick(kinds), new Date(Date.parse(p.created) + rng.int(5, 2800) * 60000).toISOString());
      const nComments = p.kind === 'shoutout' ? rng.int(0, 4) : p.kind === 'announcement' ? rng.int(0, 2) : rng.int(0, 3);
      const commenters = rng.sample([...near, ...rng.sample(pool, 4)].filter((x) => x.id !== p.author), nComments);
      let t = Date.parse(p.created);
      for (const c of commenters) {
        t += rng.int(4, 600) * 60000;
        if (t > nowMs) break;
        const target = p.targets.find((x) => x.type === 'user');
        const body = target && c.id === target.id ? rng.pick(['Thank you! This made my week.', 'Aw, thank you. Love this team.', 'You are too kind. Thank you!']) : rng.pick(COMMENTS);
        insComment.run(p.id, c.id, body, new Date(t).toISOString());
      }
      if (p.kind === 'announcement') for (const u of pool) if (rng.chance(0.58)) insRead.run(p.id, u.id, new Date(Math.min(nowMs, Date.parse(p.created) + rng.int(10, 4000) * 60000)).toISOString());
      for (const tg of p.targets) if (tg.type === 'user') insNote.run(tg.id, 'shoutout', 'You received a shout-out', null, '/', rng.chance(0.5) ? now : null, p.created);
    }

    // ---- tickets ----------------------------------------------------------------
    const insTicket = db.prepare('INSERT INTO tickets (salon_id, author_id, category, subject, body, priority, status, assignee_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const insTE = db.prepare('INSERT INTO ticket_events (ticket_id, author_id, body, status_to, created_at) VALUES (?,?,?,?,?)');
    let nTickets = 0;
    for (let i = 0; i < 34; i++) {
      const s = i < 4 && mdr ? mdr : rng.pick(salons);
      const [category, subject, body, priority] = TICKETS[i % TICKETS.length];
      const author = rng.chance(0.7) ? team.get(s.id).manager : rng.pick(team.get(s.id).stylists);
      const age = rng.int(0, 18);
      const status = age > 10 ? rng.pick(['resolved', 'closed', 'resolved']) : rng.pick(['open', 'open', 'in_progress', 'waiting', 'resolved']);
      const leader = leaders.get(s.district_id);
      const created = iso(age, rng.int(8, 17));
      const worked = status !== 'open' && leader;
      const updated = worked ? new Date(Math.min(nowMs, Date.parse(created) + rng.int(2, 60) * 3600000)).toISOString() : created;
      const id = Number(insTicket.run(s.id, author.id, category, subject, body, priority, status, worked ? leader.id : null, created, updated).lastInsertRowid);
      if (worked) {
        insTE.run(id, leader.id, rng.pick(['Thanks for flagging. I have a vendor scheduled and will confirm the time here.', 'On it. I have placed the order and it should arrive in two to three days.', 'Got it. Can you send a photo so I can pass it along?']),
          'in_progress', new Date(Date.parse(created) + 3600000 * rng.int(1, 20)).toISOString());
        if (status === 'resolved' || status === 'closed') insTE.run(id, leader.id, 'This has been taken care of. Reopen it if anything changes.', status, updated);
        else if (status === 'waiting') insTE.run(id, leader.id, 'Waiting on the vendor for a date. I will update this as soon as I hear back.', 'waiting', updated);
      }
      nTickets += 1;
    }
    summary.tickets = nTickets;

    // ---- HR inquiries (private: authors are invented stylists, replies come from the demo HR login) ----
    const insHr = db.prepare('INSERT INTO hr_inquiries (author_id, category, subject, body, status, assignee_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)');
    const insHrMsg = db.prepare('INSERT INTO hr_messages (inquiry_id, author_id, body, created_at) VALUES (?,?,?,?)');
    const hrUser = demo['demo.hr'] || uid('samantha');
    HR_INQUIRIES.forEach(([category, subject, body], i) => {
      const author = i === 0 && mdr ? team.get(mdr.id).stylists[0] : rng.pick(rng.pick(salons.map((s) => team.get(s.id).stylists)));
      const age = rng.int(1, 14);
      const created = iso(age, rng.int(9, 16));
      const answered = i % 3 !== 2;
      const replyAt = new Date(Math.min(nowMs, Date.parse(created) + rng.int(2, 30) * 3600000)).toISOString();
      const id = Number(insHr.run(author.id, category, subject, body, answered ? (i % 2 ? 'resolved' : 'in_progress') : 'open', answered ? hrUser : null, created, answered ? replyAt : created).lastInsertRowid);
      if (answered) insHrMsg.run(id, hrUser, 'Thanks for reaching out. I am looking into this and will have an answer for you within two business days. If anything is urgent in the meantime, reply here.', replyAt);
    });

    // ---- acknowledgements and a few notifications for the preview logins ----------
    const ackable = db.prepare('SELECT id FROM resources WHERE requires_ack = 1').all();
    const insAck = db.prepare('INSERT OR IGNORE INTO acknowledgements (resource_id, user_id, acknowledged_at) VALUES (?,?,?)');
    const demoIds = new Set([uid('demo.manager'), uid('demo.stylist'), ...Object.values(demo)]);
    for (const u of people) {
      if (demoIds.has(u.id)) continue; // preview logins keep their to-do list full
      for (const a of ackable) if (rng.chance(0.64)) insAck.run(a.id, u.id, iso(rng.int(0, 20), 12));
    }
    for (const id of demoIds) {
      if (!id) continue;
      insNote.run(id, 'welcome', 'Welcome to the portal', 'Start with your salon page, then say thanks to a teammate with a shout-out.', '/', null, now);
      insNote.run(id, 'promo', 'Holiday gift cards are live', 'Buy $50, get a $10 bonus card. Talking points are under Promos.', '/promos', null, iso(1, 9));
    }
  })();

  log(`sample data: ${summary.people} people, ${summary.posts} posts, ${summary.tickets} tickets, ${summary.kpi_days} days of KPIs`);
  return summary;
}

module.exports = { seedSample, makeRng, DEFAULT_VALUES, DEFAULT_CHECKLISTS };
