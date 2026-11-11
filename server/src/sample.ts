import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Creates a small library of ORIGINAL sample works (generated SVG art, original prose) so a fresh
 * install has something to read even with no network. Runs only when the library folder is empty.
 * Delete data/library/* and restart to regenerate; drop your own folders in to replace them.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

function bubble(x: number, y: number, w: number, text: string, size = 22) {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  const max = Math.floor(w / (size * 0.55));
  for (const wd of words) {
    if ((line + ' ' + wd).trim().length > max) { lines.push(line.trim()); line = wd; } else line += ' ' + wd;
  }
  lines.push(line.trim());
  const h = lines.length * size * 1.25 + size;
  return `<g><ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2 + 18}" ry="${h / 2 + 10}" fill="#fff" stroke="#111" stroke-width="3"/>
    ${lines.map((l, i) => `<text x="${x + w / 2}" y="${y + size * 1.1 + i * size * 1.25}" font-family="'Comic Neue','Comic Sans MS',sans-serif" font-size="${size}" text-anchor="middle" fill="#111">${esc(l)}</text>`).join('')}</g>`;
}

function scenery(x: number, y: number, w: number, h: number, r: () => number, palette: string[]) {
  const sky = palette[Math.floor(r() * palette.length)];
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${sky}"/>`;
  const hills = 3 + Math.floor(r() * 3);
  for (let i = 0; i < hills; i++) {
    const cy = y + h * (0.55 + r() * 0.35);
    s += `<ellipse cx="${x + r() * w}" cy="${cy}" rx="${w * (0.3 + r() * 0.4)}" ry="${h * (0.15 + r() * 0.2)}" fill="rgba(20,20,40,${0.25 + i * 0.12})"/>`;
  }
  for (let i = 0; i < 4; i++) { // lanterns
    const lx = x + 30 + r() * (w - 60), ly = y + 20 + r() * h * 0.4;
    s += `<line x1="${lx}" y1="${y}" x2="${lx}" y2="${ly}" stroke="#222" stroke-width="2"/><rect x="${lx - 12}" y="${ly}" width="24" height="34" rx="10" fill="#f5a623" stroke="#7a3e00" stroke-width="2"/>`;
  }
  return s;
}

function figure(cx: number, base: number, scale: number, color: string) {
  return `<g transform="translate(${cx},${base}) scale(${scale})">
    <path d="M-40,0 Q-45,-120 0,-130 Q45,-120 40,0 Z" fill="${color}" stroke="#111" stroke-width="4"/>
    <circle cx="0" cy="-170" r="42" fill="#ffe0c2" stroke="#111" stroke-width="4"/>
    <path d="M-44,-180 Q-30,-230 10,-222 Q50,-215 44,-170 Q30,-200 -10,-200 Z" fill="#2b2b3a"/>
    <circle cx="-14" cy="-168" r="5" fill="#111"/><circle cx="14" cy="-168" r="5" fill="#111"/>
    <path d="M-10,-148 Q0,-140 10,-148" stroke="#111" stroke-width="3" fill="none"/></g>`;
}

function mangaPage(series: string, ch: number, p: number, lines: string[], palette: string[]) {
  const W = 1000, H = 1500, M = 40, G = 20;
  const r = rng(ch * 100 + p * 7 + series.length);
  const rows = 2 + Math.floor(r() * 2);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fafafa"/>`;
  const rowH = (H - 2 * M - (rows - 1) * G) / rows;
  let li = 0;
  for (let i = 0; i < rows; i++) {
    const cols = r() > 0.5 ? 2 : 1;
    const colW = (W - 2 * M - (cols - 1) * G) / cols;
    for (let j = 0; j < cols; j++) {
      const x = M + j * (colW + G), y = M + i * (rowH + G);
      svg += `<g><clipPath id="c${i}${j}"><rect x="${x}" y="${y}" width="${colW}" height="${rowH}"/></clipPath><g clip-path="url(#c${i}${j})">${scenery(x, y, colW, rowH, r, palette)}
        ${figure(x + colW * (0.3 + r() * 0.4), y + rowH + 20, 0.8 + r() * 0.6, ['#c0392b', '#2980b9', '#8e44ad', '#16a085'][Math.floor(r() * 4)])}</g>
        <rect x="${x}" y="${y}" width="${colW}" height="${rowH}" fill="none" stroke="#111" stroke-width="5"/></g>`;
      if (lines[li]) svg += bubble(x + 24, y + 24, Math.min(colW - 80, 360), lines[li++], 24);
    }
  }
  svg += `<text x="${W - M}" y="${H - 12}" font-family="sans-serif" font-size="18" text-anchor="end" fill="#999">${p + 1}</text></svg>`;
  return svg;
}

function stripPage(ch: number, p: number, line: string) {
  const W = 800, H = 2000;
  const r = rng(ch * 31 + p * 13);
  const hue = Math.floor(r() * 360);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,75%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,35%)"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>`;
  for (let i = 0; i < 9; i++) { // skyline
    const bw = 60 + r() * 90, bh = 300 + r() * 700, bx = r() * W;
    svg += `<rect x="${bx}" y="${H - bh}" width="${bw}" height="${bh}" fill="rgba(15,15,35,${0.4 + r() * 0.4})"/>`;
    for (let k = 0; k < 12; k++) svg += `<rect x="${bx + 10 + (k % 3) * (bw / 3.4)}" y="${H - bh + 20 + Math.floor(k / 3) * 60}" width="12" height="20" fill="${r() > 0.5 ? '#ffe9a3' : '#334'}"/>`;
  }
  svg += figure(W / 2 + (r() - 0.5) * 300, 900, 1.6, '#e67e22');
  svg += bubble(80, 140 + r() * 300, 520, line, 30);
  return svg + '</svg>';
}

function cover(title: string, subtitle: string, c1: string, c2: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="600" height="900" fill="url(#g)"/>
  <circle cx="460" cy="190" r="120" fill="rgba(255,255,255,.15)"/><circle cx="120" cy="720" r="200" fill="rgba(0,0,0,.18)"/>
  ${figure(300, 860, 2.2, 'rgba(20,20,30,.85)')}
  <rect x="0" y="40" width="600" height="${subtitle ? 170 : 130}" fill="rgba(0,0,0,.35)"/>
  <text x="300" y="120" font-family="Georgia,serif" font-size="${title.length > 22 ? 40 : 52}" font-weight="700" text-anchor="middle" fill="#fff">${esc(title)}</text>
  ${subtitle ? `<text x="300" y="175" font-family="sans-serif" font-size="24" text-anchor="middle" fill="#f0e6ff" letter-spacing="4">${esc(subtitle)}</text>` : ''}
  </svg>`;
}

const MANGA_SCRIPT = [
  ['The festival lanterns are lit early this year.', 'Grandmother says that means a visitor is coming.', 'You believe those stories?', 'I believe the lanterns.', 'Look — that one is moving against the wind.', 'Kaito, wait!'],
  ['It stopped at the old shrine gate.', 'Nobody has opened that gate in forty years.', 'Then why is it warm?', 'Someone is on the other side.', 'Hello? We can hear you.', '...Finally. I have been knocking for a very long time.'],
  ['You are the visitor from the stories?', 'I am a lantern-keeper. I lost my light.', 'Can we help you find it?', 'Only someone born on festival night can carry it.', 'That is me. I was born under the lanterns.', 'Then, Kaito — will you walk with me until dawn?'],
];
const STRIP_SCRIPT = [
  ['Rooftop deliveries: fastest in the city.', 'Package for the 88th floor. No elevator.', "Good thing I don't need one.", 'Hold on tight, little parcel.', 'Signed, sealed, delivered — before sunrise.'],
  ['A new route opened over the river.', 'The bridge cranes are still moving.', "Timing is everything. Three... two...", 'Jump!', 'Made it. Barely. Again.'],
];
const NOVEL = [
  `# Chapter 1 — The Blank Map

The first map Ilse ever drew was of a room she had never seen.

She was nine, and the paper was the back of a bakery receipt, and the room had seven doors and a window that looked out on the sea. Her mother laughed and pinned it to the kitchen wall. Her father, who said very little about anything, looked at it for a long time and then went out to the harbor without his coat.

*Maps are promises,* Master Oren told her years later, on the morning she arrived at the guildhall with a satchel of pencils and no letter of introduction. *A map says: if you walk this way, the world will keep its word. Our work is to make sure it does.*

He handed her a sheet of vellum so white it seemed to hum.

"Draw me somewhere true," he said.

She drew the room with seven doors.`,
  `# Chapter 2 — Ink That Remembers

The guild kept its inks in a cellar that smelled of iron and rain. There were inks for rivers and inks for roads, a green that only took to forests, and on the highest shelf a single stoppered bottle with no label at all.

"That one remembers," said Teodor, the senior apprentice, when he caught her looking. He was sixteen and wore his ink-stains like medals. "Draw a place with it and the map shows what the place used to be. Master Oren uses it for disputes. Old borders. Old wells."

"Has anyone ever drawn a place that doesn't exist?"

Teodor laughed, then stopped, because she wasn't joking.

That night she took the bottle down. She told herself she would only look. The ink inside was not black but the deep blue of the hour before morning, and when she uncorked it the cellar went very quiet, as though the whole building were holding its breath.`,
  `# Chapter 3 — The Seventh Door

She drew the room again, in the ink that remembers.

Line by line the doors appeared, and the window, and beyond the window a sea she had never sailed. Then the ink did something no ink should do: it kept moving after her pen had lifted. A staircase unspooled from the seventh door. A name wrote itself in the corner in handwriting she knew from birthday cards and grocery lists.

*Her father's.*

Ilse sat back on her heels. Above her the guildhall bells began to ring the hour, though it was nowhere near the hour, and footsteps sounded on the cellar stairs.

"Ilse." Master Oren stood in the doorway with a lantern, and his face was not angry. It was afraid. "Tell me you didn't open the blue."

She looked down at the map, at the seventh door, which was very slowly, very surely, swinging open.

"I think," she said, "it opened me."`,
];

export function ensureSampleLibrary() {
  const root = config.libraryDir;
  if (fs.readdirSync(root).length > 0) return;
  console.log('[sample] Creating original sample works in', root);

  const manga = path.join(root, 'lanterns-over-kirihara');
  fs.mkdirSync(manga, { recursive: true });
  fs.writeFileSync(path.join(manga, 'series.json'), JSON.stringify({
    title: 'Lanterns Over Kirihara', type: 'manga', status: 'ongoing', year: 2026, demographic: 'shounen', authors: ['Kimoto Studio'], artists: ['Kimoto Studio'],
    genres: ['Fantasy', 'Adventure', 'Slice of Life', 'Supernatural'], tags: ['Festival', 'Folklore', 'Sample'], altTitles: ['Kirihara no Chouchin'],
    description: 'An original sample series bundled with Kimoto. On festival night in a seaside town, a boy follows a lantern that drifts against the wind — and finds a stranger knocking on a gate that has been shut for forty years.',
  }, null, 2));
  fs.writeFileSync(path.join(manga, 'cover.svg'), cover('Lanterns Over Kirihara', 'A KIMOTO ORIGINAL', '#ff7e5f', '#2b1055'));
  const titles = ['The Moving Lantern', 'The Shrine Gate', 'Until Dawn'];
  MANGA_SCRIPT.forEach((script, ci) => {
    const dir = path.join(manga, `Ch. ${String(ci + 1).padStart(3, '0')} - ${titles[ci]}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let p = 0; p < 6; p++) fs.writeFileSync(path.join(dir, `${String(p + 1).padStart(2, '0')}.svg`), mangaPage('kirihara', ci + 1, p, script.slice(p, p + 2), ['#ffd3a5', '#fd6585', '#c3cfe2', '#f6d365', '#a1c4fd']));
  });

  const strip = path.join(root, 'skyline-courier');
  fs.mkdirSync(strip, { recursive: true });
  fs.writeFileSync(path.join(strip, 'series.json'), JSON.stringify({
    title: 'Skyline Courier', type: 'webtoon', status: 'ongoing', year: 2026, authors: ['Kimoto Studio'], genres: ['Action', 'Comedy', 'Sci-Fi'], tags: ['Parkour', 'City', 'Sample'],
    description: 'An original vertical-scroll sample. In a city of towers, the fastest courier never takes the stairs.',
  }, null, 2));
  fs.writeFileSync(path.join(strip, 'cover.svg'), cover('Skyline Courier', 'VERTICAL SAMPLE', '#43cea2', '#185a9d'));
  STRIP_SCRIPT.forEach((script, ci) => {
    const dir = path.join(strip, `Episode ${ci + 1}`);
    fs.mkdirSync(dir, { recursive: true });
    script.forEach((line, p) => fs.writeFileSync(path.join(dir, `${String(p + 1).padStart(2, '0')}.svg`), stripPage(ci + 1, p, line)));
  });

  const novel = path.join(root, 'the-cartographers-apprentice');
  fs.mkdirSync(novel, { recursive: true });
  fs.writeFileSync(path.join(novel, 'series.json'), JSON.stringify({
    title: "The Cartographer's Apprentice", type: 'novel', status: 'ongoing', year: 2026, authors: ['Kimoto Studio'], genres: ['Fantasy', 'Mystery', 'Drama'], tags: ['Maps', 'Magic', 'Sample'],
    description: 'An original light novel sample. Ilse joins the mapmakers’ guild and uncorks an ink that remembers — and a door that should not exist begins to open.',
  }, null, 2));
  fs.writeFileSync(path.join(novel, 'cover.svg'), cover("The Cartographer's Apprentice", 'LIGHT NOVEL SAMPLE', '#614385', '#516395'));
  NOVEL.forEach((text, i) => fs.writeFileSync(path.join(novel, `Chapter ${i + 1}.md`), text));
}
