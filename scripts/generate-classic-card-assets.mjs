import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const WIDTH = 500;
const HEIGHT = 700;

const SUITS = [
  { code: "S", name: "spades", symbol: "♠", color: "#171717" },
  { code: "C", name: "clubs", symbol: "♣", color: "#171717" },
  { code: "D", name: "diamonds", symbol: "♦", color: "#b3262d" },
  { code: "H", name: "hearts", symbol: "♥", color: "#b3262d" },
];

const STANDARD_RANKS = [
  { rank: "J", name: "jack", points: 30 },
  { rank: "9", name: "nine", points: 20 },
  { rank: "A", name: "ace", points: 11 },
  { rank: "10", name: "ten", points: 10 },
  { rank: "K", name: "king", points: 3 },
  { rank: "Q", name: "queen", points: 2 },
  { rank: "8", name: "eight", points: 0 },
  { rank: "7", name: "seven", points: 0 },
];

const EXTRA_RANKS = [
  { rank: "3", name: "three", points: 50 },
  { rank: "2", name: "two", points: 100 },
  { rank: "6", name: "six", points: 0 },
];

const PIP_LAYOUTS = {
  2: [
    [250, 190, false],
    [250, 510, true],
  ],
  3: [
    [250, 170, false],
    [250, 350, false],
    [250, 530, true],
  ],
  6: [
    [160, 170, false],
    [340, 170, false],
    [160, 350, false],
    [340, 350, true],
    [160, 530, true],
    [340, 530, true],
  ],
  7: [
    [160, 160, false],
    [340, 160, false],
    [250, 255, false],
    [160, 350, false],
    [340, 350, true],
    [160, 540, true],
    [340, 540, true],
  ],
  8: [
    [160, 150, false],
    [340, 150, false],
    [250, 245, false],
    [160, 315, false],
    [340, 385, true],
    [250, 455, true],
    [160, 550, true],
    [340, 550, true],
  ],
  9: [
    [160, 145, false],
    [340, 145, false],
    [160, 275, false],
    [340, 275, false],
    [250, 350, false],
    [160, 425, true],
    [340, 425, true],
    [160, 555, true],
    [340, 555, true],
  ],
  10: [
    [160, 140, false],
    [340, 140, false],
    [250, 220, false],
    [160, 290, false],
    [340, 290, false],
    [160, 410, true],
    [340, 410, true],
    [250, 480, true],
    [160, 560, true],
    [340, 560, true],
  ],
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function svgDocument(title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<title>${escapeXml(title)}</title>
${body}
</svg>
`;
}

function cornerIndex(rank, suit, rotation = 0) {
  const transform = rotation
    ? ` transform="rotate(180 ${WIDTH / 2} ${HEIGHT / 2})"`
    : "";
  return `<g${transform} fill="${suit.color}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
  <text x="60" y="90" font-size="${rank === "10" ? 58 : 68}" font-weight="700">${escapeXml(rank)}</text>
  <text x="60" y="150" font-size="60">${suit.symbol}</text>
</g>`;
}

function pip(suit, x, y, rotated) {
  const transform = rotated ? ` transform="rotate(180 ${x} ${y})"` : "";
  return `<text x="${x}" y="${y + 35}"${transform} fill="${suit.color}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="105">${suit.symbol}</text>`;
}

function renderNumberBody(rank, suit) {
  return PIP_LAYOUTS[rank]
    .map(([x, y, rotated]) => pip(suit, x, y, rotated))
    .join("\n");
}

function renderAceBody(suit) {
  return `<text x="250" y="425" fill="${suit.color}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="245">${suit.symbol}</text>`;
}

function courtHalf(rank, suit) {
  const jacketColor = rank === "J" ? "#315f9d" : suit.color;
  const crown =
    rank === "K"
      ? `<path d="M177 202 196 143 230 184 264 132 299 184 331 143 342 202Z" fill="#d3a72f" stroke="#171717" stroke-width="6"/>
<circle cx="196" cy="143" r="8" fill="${suit.color}"/><circle cx="264" cy="132" r="8" fill="${suit.color}"/><circle cx="331" cy="143" r="8" fill="${suit.color}"/>`
      : rank === "Q"
        ? `<path d="M184 199 205 153 235 184 263 143 292 184 322 153 340 199Z" fill="#d3a72f" stroke="#171717" stroke-width="6"/>
<circle cx="205" cy="153" r="8" fill="${suit.color}"/><circle cx="263" cy="143" r="8" fill="${suit.color}"/><circle cx="322" cy="153" r="8" fill="${suit.color}"/>`
        : `<path d="M187 198 214 157 250 184 286 157 326 198Z" fill="#3f67a8" stroke="#171717" stroke-width="6"/>
<path d="M311 171q42-42 59-5-31 4-47 29Z" fill="${suit.color}" stroke="#171717" stroke-width="5"/>`;

  const accessory =
    rank === "K"
      ? `<path d="M315 260 350 218 367 232 331 276Z" fill="#d3a72f" stroke="#171717" stroke-width="5"/>`
      : rank === "Q"
        ? `<circle cx="343" cy="263" r="22" fill="#f7f2e7" stroke="#171717" stroke-width="5"/>
<path d="M343 240v46M320 263h46M327 247l32 32M359 247l-32 32" stroke="${suit.color}" stroke-width="7"/>`
        : `<path d="M306 305 355 176" stroke="#171717" stroke-width="14" stroke-linecap="round"/>
<path d="M306 305 355 176" stroke="#c7ced7" stroke-width="7" stroke-linecap="round"/>
<path d="M344 187 375 157 363 201Z" fill="#c7ced7" stroke="#171717" stroke-width="5"/>`;

  const hair =
    rank === "Q"
      ? `<path d="M217 198q-27 32-13 88l34-31-8-58Z" fill="#6a352a" stroke="#171717" stroke-width="5"/>
<path d="M297 198q27 32 13 88l-34-31 8-58Z" fill="#6a352a" stroke="#171717" stroke-width="5"/>`
      : rank === "J"
        ? `<path d="M216 218q13-45 91-9-30-7-48-25-18 22-43 34Z" fill="#51372b"/>`
        : "";

  const facialHair =
    rank === "K"
      ? `<path d="M220 251q37 51 76 0-3 58-38 66-36-8-38-66Z" fill="#5b3428" stroke="#171717" stroke-width="4"/>
<path d="M235 254q22 15 45 0" fill="none" stroke="#171717" stroke-width="7" stroke-linecap="round"/>`
      : "";

  const faceDetails =
    rank === "J"
      ? `<circle cx="271" cy="232" r="5" fill="#171717"/>
<path d="M282 232 300 242 282 249" fill="#f1c9a5" stroke="#171717" stroke-width="4" stroke-linejoin="round"/>
<path d="M263 258q13 6 24-2" fill="none" stroke="#8b4b3c" stroke-width="4" stroke-linecap="round"/>`
      : `<circle cx="238" cy="232" r="4.5" fill="#171717"/><circle cx="278" cy="232" r="4.5" fill="#171717"/>
<path d="M246 253q12 9 25 0" fill="none" stroke="#8b4b3c" stroke-width="4" stroke-linecap="round"/>`;

  return `<g>
  ${crown}
${hair ? `  ${hair}\n` : ""}\
  <ellipse cx="257" cy="230" rx="55" ry="49" fill="#f1c9a5" stroke="#171717" stroke-width="5"/>
${facialHair ? `  ${facialHair}\n` : ""}\
  ${faceDetails}
  <path d="M170 336q20-82 87-82t87 82Z" fill="${jacketColor}" stroke="#171717" stroke-width="6"/>
  <path d="M213 278 257 328 301 278" fill="#f7f2e7" stroke="#171717" stroke-width="5"/>
  <path d="M180 327 220 292M334 327 294 292" stroke="#d3a72f" stroke-width="9"/>
  ${accessory}
  <text x="257" y="327" fill="#f7f2e7" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="48">${suit.symbol}</text>
</g>`;
}

function renderCourtBody(rank, suit) {
  const half = courtHalf(rank, suit);
  return `<defs><clipPath id="court-window"><rect x="105" y="118" width="290" height="464" rx="16"/></clipPath></defs>
<rect x="105" y="118" width="290" height="464" rx="16" fill="#f4ead6" stroke="#171717" stroke-width="5"/>
<g clip-path="url(#court-window)">
  ${half}
  <g transform="rotate(180 250 350)">${half}</g>
</g>
<path d="M105 350h290" stroke="#171717" stroke-width="4"/>
<path d="M121 350h258" stroke="${suit.color}" stroke-width="9"/>`;
}

function renderFace(rank, suit) {
  const body =
    rank === "A"
      ? renderAceBody(suit)
      : ["J", "Q", "K"].includes(rank)
        ? renderCourtBody(rank, suit)
        : renderNumberBody(rank, suit);

  return svgDocument(
    `${rank} of ${suit.name}`,
    `<rect x="6" y="6" width="488" height="688" rx="28" fill="#fffdf8" stroke="#c8c3b8" stroke-width="6"/>
${cornerIndex(rank, suit)}
${cornerIndex(rank, suit, 180)}
${body}`,
  );
}

function renderBack() {
  const diamonds = [];
  for (let y = 72; y <= 628; y += 32) {
    for (let x = 58; x <= 442; x += 32) {
      diamonds.push(
        `<path d="M${x} ${y - 11}  ${x + 11} ${y} ${x} ${y + 11} ${x - 11} ${y}Z" fill="${
          (x + y) % 64 === 0 ? "#fff8e8" : "#9f1f2b"
        }" stroke="#74141d" stroke-width="2"/>`,
      );
    }
  }

  return svgDocument(
    "Classic card back",
    `<rect x="6" y="6" width="488" height="688" rx="28" fill="#fffdf8" stroke="#c8c3b8" stroke-width="6"/>
<rect x="24" y="24" width="452" height="652" rx="20" fill="#9f1f2b" stroke="#74141d" stroke-width="6"/>
<g>${diamonds.join("\n")}</g>
<rect x="42" y="42" width="416" height="616" rx="13" fill="none" stroke="#fff8e8" stroke-width="7"/>
<rect x="54" y="54" width="392" height="592" rx="9" fill="none" stroke="#74141d" stroke-width="4"/>`,
  );
}

function createCardRecord(rankRecord, suit, standard) {
  const collection = standard ? "standard_304" : "variant_extras";
  const id = `${suit.code}_${rankRecord.rank}`;
  return {
    id,
    rank: rankRecord.rank,
    rank_name: rankRecord.name,
    suit: suit.code,
    suit_name: suit.name,
    points: rankRecord.points,
    ...(standard
      ? { rank_order_high_to_low: STANDARD_RANKS.indexOf(rankRecord) + 1 }
      : {}),
    standard_304: standard,
    svg: `cards/${collection}/svg/${id}_${suit.name}_${rankRecord.name}.svg`,
  };
}

async function generateCollection(ranks, standard) {
  const records = [];
  for (const rankRecord of ranks) {
    for (const suit of SUITS) {
      const record = createCardRecord(rankRecord, suit, standard);
      const outputPath = path.join(repositoryRoot, "assets", record.svg);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, renderFace(rankRecord.rank, suit));
      records.push(record);
    }
  }
  return records;
}

const standardCards = await generateCollection(STANDARD_RANKS, true);
const variantExtraCards = await generateCollection(EXTRA_RANKS, false);

const backPath = "backs/svg/card_back_304_ceylon.svg";
await mkdir(path.join(repositoryRoot, "assets/backs/svg"), { recursive: true });
await writeFile(path.join(repositoryRoot, "assets", backPath), renderBack());

const manifest = {
  pack_name: "Classic Playing Card Asset Pack",
  version: "2.0.0",
  image_size_px: { width: WIDTH, height: HEIGHT },
  standard_304_rank_order_high_to_low: STANDARD_RANKS.map(({ rank }) => rank),
  standard_304_point_values: Object.fromEntries(
    STANDARD_RANKS.map(({ rank, points }) => [rank, points]),
  ),
  suits: Object.fromEntries(
    SUITS.map(({ code, name, symbol }) => [code, { name, symbol }]),
  ),
  standard_cards: standardCards,
  variant_extra_cards: variantExtraCards,
  card_back: { svg: backPath },
};

await writeFile(
  path.join(repositoryRoot, "assets/card_manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

const csvRows = [...standardCards, ...variantExtraCards].map((card) =>
  [
    card.id,
    card.rank,
    card.suit,
    card.points,
    card.standard_304,
    `assets/${card.svg}`,
  ].join(","),
);
await writeFile(
  path.join(repositoryRoot, "docs/resources/card_list.csv"),
  `id,rank,suit,points,standard_304,svg\n${csvRows.join("\n")}\n`,
);
