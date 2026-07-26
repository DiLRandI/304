import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestPath = path.join(repositoryRoot, "assets/card_manifest.json");
const cardListPath = path.join(repositoryRoot, "docs/resources/card_list.csv");

const forbiddenArtwork = [
  /(?:^|[^0-9])304(?:[^0-9]|$)/i,
  /\bpts?\b/i,
  /Sri Lankan 304 rank value/i,
  /HIGH 304/i,
  /<linearGradient\b/i,
  /<radialGradient\b/i,
  /softMedallion/i,
];

test("classic card asset pack is SVG-only, complete, and free of game decoration", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const cards = [...manifest.standard_cards, ...manifest.variant_extra_cards];

  assert.equal(manifest.standard_cards.length, 32);
  assert.equal(manifest.variant_extra_cards.length, 12);
  assert.equal(new Set(cards.map((card) => card.id)).size, 44);
  assert.equal(manifest.card_back.svg, "backs/svg/card_back_304_ceylon.svg");
  assert.ok(!("png" in manifest.card_back));

  for (const card of cards) {
    assert.equal(typeof card.svg, "string", `${card.id} must have an SVG path`);
    assert.ok(!("png" in card), `${card.id} must not publish a PNG path`);

    const artworkPath = path.join(repositoryRoot, "assets", card.svg);
    assert.ok(fs.existsSync(artworkPath), `${card.id} SVG must exist`);

    const artwork = fs.readFileSync(artworkPath, "utf8");
    assert.match(
      artwork,
      new RegExp(`<title>${card.rank} of ${card.suit_name}</title>`),
      `${card.id} must describe the standalone SVG`,
    );
    for (const forbidden of forbiddenArtwork) {
      assert.doesNotMatch(artwork, forbidden, `${card.id}: ${forbidden}`);
    }
  }

  const backPath = path.join(repositoryRoot, "assets", manifest.card_back.svg);
  const back = fs.readFileSync(backPath, "utf8");
  assert.match(back, /<title>Classic card back<\/title>/);
  assert.doesNotMatch(back, /<text\b/i);
  for (const forbidden of forbiddenArtwork) {
    assert.doesNotMatch(back, forbidden);
  }

  const [header, ...rows] = fs
    .readFileSync(cardListPath, "utf8")
    .trim()
    .split(/\r?\n/);
  assert.equal(header, "id,rank,suit,points,standard_304,svg");
  assert.equal(rows.length, 44);
});
