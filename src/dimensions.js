// Item dimensions in millimetres, shared by Ozon, DNS and Yandex Market cards.
// Packaging and built-in sizes are never substituted for a missing item size (see warnings).
const UNIT_MM = { 'мм': 1, 'см': 10, 'м': 1000 };
const PACKAGE_WORD = /упаковк|встраивани|короб/i;
// Only the whole item: "Высота", "Высота изделия", "Высота, см". Seat, back, sleeping place or niche sizes
// ("Высота сиденья", "Ширина ниши") never stand in for the overall size, whatever order the page lists them in.
const ITEM = String.raw`(?:\s+(?:изделия|предмета|товара|общая))?(?:\s*\(?(?:мм|см|м)\)?)?`;
const AXIS_WORDS = Object.fromEntries(Object.entries({ width: 'ширина', depth: 'глубина', height: 'высота' })
  .map(([axis, word]) => [axis, new RegExp(`^${word}${ITEM}$`, 'i')]));
const LETTER_AXIS = { 'ш': 'width', 'г': 'depth', 'д': 'depth', 'в': 'height' };
const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const TRIPLET = new RegExp(`^${NUMBER}\\s*[xх×*]\\s*${NUMBER}\\s*[xх×*]\\s*${NUMBER}\\s*(мм|см|м)?$`, 'i');

const round = (mm) => Math.round(mm * 100) / 100;
const toNumber = (text) => Number(String(text).replace(',', '.'));

/** "389 мм" / "38,5 см"; a bare number uses keyUnit (the unit named in the characteristic key). */
export function parseLengthMm(text, keyUnit = null) {
  const m = String(text || '').trim().match(new RegExp(`^${NUMBER}\\s*(мм|см|м)?$`, 'i'));
  const unit = m && (m[2] || keyUnit);
  if (!unit) return null;
  const value = toNumber(m[1]) * UNIT_MM[unit.toLowerCase()];
  return Number.isFinite(value) && value > 0 ? round(value) : null;
}

/** DNS keys are "Group / Title"; Ozon keys carry the unit: "Ширина, см". */
function splitKey(key) {
  const title = String(key).split(' / ').at(-1).trim();
  const unit = title.match(/,\s*(мм|см|м)\s*$/i)?.[1] || null;
  return { title, unit, name: title.replace(/,\s*(мм|см|м)\s*$/i, '').trim() };
}

export function dimensionsFromLabeled(characteristics) {
  const dimensions_mm = { width: null, depth: null, height: null };
  for (const [key, value] of Object.entries(characteristics || {})) {
    if (PACKAGE_WORD.test(key)) continue;
    const { name, unit } = splitKey(key);
    for (const [axis, re] of Object.entries(AXIS_WORDS)) {
      if (dimensions_mm[axis] == null && re.test(name)) dimensions_mm[axis] = parseLengthMm(value, unit);
    }
  }
  return dimensions_mm;
}

const LETTERS = /([ШГДВ])\s*[xх×*]\s*([ШГДВ])\s*[xх×*]\s*([ШГДВ])/i;
const AXES = ['width', 'depth', 'height'];

/** Three lengths in mm from "90x150x75 см", or from a bare "527х306х51" when the key names the unit. */
function tripletMm(value, keyUnit) {
  const m = String(value || '').trim().match(TRIPLET);
  const unit = m && (m[4] || keyUnit);
  return unit ? [m[1], m[2], m[3]].map((n) => round(toNumber(n) * UNIT_MM[unit.toLowerCase()])) : null;
}

/** "90x150x75 см": axes follow the Ш/Г/Д/В letters of the label; without letters W×D×H (Yandex "Размеры"). */
export function dimensionsFromTriplet(label, value, keyUnit = null) {
  const dimensions_mm = { width: null, depth: null, height: null };
  const numbers = tripletMm(value, keyUnit);
  if (!numbers) return dimensions_mm;
  const pattern = String(label || '').match(LETTERS);
  const axes = pattern ? pattern.slice(1).map((l) => LETTER_AXIS[l.toLowerCase()]) : AXES;
  if (new Set(axes).size !== 3) return dimensions_mm;
  axes.forEach((axis, i) => { dimensions_mm[axis] = numbers[i]; });
  return dimensions_mm;
}

/**
 * A letterless triplet's order is unknown when labeled axes exist (Ozon lists D×W×H). Known axes
 * are matched out of it; a single remaining number fills a single missing axis. A triplet that
 * does not contain the known values is ignored.
 */
function fillFromLetterless(known, numbers) {
  const missing = AXES.filter((axis) => known[axis] == null);
  const rest = [...numbers];
  for (const axis of AXES) {
    if (known[axis] == null) continue;
    const i = rest.findIndex((n) => Math.abs(n - known[axis]) <= 1);
    if (i < 0) return known;
    rest.splice(i, 1);
  }
  return missing.length === 1 && rest.length === 1 ? { ...known, [missing[0]]: rest[0] } : known;
}

/** Labeled axes take priority over "Размеры"/"Габариты" triplets. */
export function dimensionsFromAny(characteristics) {
  let out = dimensionsFromLabeled(characteristics);
  const anyKnown = AXES.some((axis) => out[axis] != null);
  for (const [key, value] of Object.entries(characteristics || {})) {
    const { title, unit } = splitKey(key);
    if (PACKAGE_WORD.test(key) || !/размер|габарит/i.test(title)) continue;
    if (LETTERS.test(title) || !anyKnown) {
      const triplet = dimensionsFromTriplet(title, value, unit);
      out = Object.fromEntries(AXES.map((axis) => [axis, out[axis] ?? triplet[axis]]));
    } else {
      const numbers = tripletMm(value, unit);
      if (numbers) out = fillFromLetterless(out, numbers);
    }
  }
  return out;
}

export function withItemDimensions(card, imageUrl) {
  const dimensions_mm = dimensionsFromAny(card.characteristics);
  return { ...card, dimensions_mm, image_url: imageUrl || null, warnings: dimensionsWarning(dimensions_mm) };
}

export function dimensionsWarning(dimensions_mm) {
  return Object.values(dimensions_mm).some((v) => v == null)
    ? ['Item dimensions are incomplete; packaging dimensions were not substituted.']
    : [];
}
