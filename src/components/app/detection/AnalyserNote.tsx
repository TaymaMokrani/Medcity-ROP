/**
 * The analyser's explanation, as points rather than a paragraph.
 *
 * When an axis cannot be measured the pipeline writes several sentences saying
 * what it saw, what it inferred, what it rejected and how sure it is. As one
 * block of small grey type none of that is findable: the zone it suggests and
 * the reason it is only a suggestion sit in the middle of the same sentence.
 *
 * Nothing is reworded. The text is split where it already breaks, a leading
 * label is pulled out where the analyser wrote one, restatements are dropped,
 * and so are the points listed in `DROP` and `TRIM` below — the pipeline's
 * notes about its own coverage, which describe the photographs rather than the
 * baby. What is left is reproduced exactly: rewriting clinical prose to sound
 * better is how a caveat quietly becomes a claim.
 */
export default function AnalyserNote({ text }: { text?: string }) {
  const points = text ? toPoints(text) : [];

  if (points.length === 0) return null;
  if (points.length === 1) {
    return <p className="mt-1 text-label leading-relaxed text-ink-2">{text}</p>;
  }

  return (
    <ul className="mt-1 space-y-1">
      {points.map((point) => (
        <li
          key={point.text}
          className="flex gap-2 text-label leading-relaxed text-ink-2"
        >
          <span className="mt-[0.5em] size-1 shrink-0 rounded-full bg-ink-3" />
          <span>
            {point.label && (
              <span className="font-medium text-ink">{point.label}: </span>
            )}
            {point.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Point {
  label?: string;
  text: string;
}

/**
 * Points about how much of the retina the photographs covered. True, and about
 * the pictures rather than the eye. How far the reading reached is already on
 * the eye card, as the count of photographs aligned.
 */
const DROP = [
  /^confidence/i,
  /vessels continued past the edge/i,
];

/**
 * Clauses that explain why the analyser set a number aside. The number it
 * used is the headline; why it rejected the other one is pipeline reasoning.
 */
const TRIM = [/,?\s*but on (an )?unverified fronts?[\s\S]*$/i];

/** Words too common to tell two sentences apart. */
const COMMON = new Set([
  "that", "this", "with", "from", "than", "then", "they", "them", "there",
  "which", "where", "what", "when", "were", "been", "being", "have", "has",
  "and", "but", "not", "the", "for", "are", "its", "it", "is", "of", "on",
  "in", "a", "an", "so", "at", "to", "by", "or", "as", "reads", "rather",
]);

/**
 * Split where the analyser already breaks: full stops and semicolons. The
 * lookbehind ignores decimals, because "8.2 DD" is not the end of a sentence.
 */
function toPoints(text: string): Point[] {
  const sentences = text
    .split(/(?<=[.;])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const points: Point[] = [];
  const seen = new Set<string>();

  for (const raw of sentences) {
    if (DROP.some((pattern) => pattern.test(raw))) continue;

    const sentence = TRIM.reduce(
      (text, pattern) => text.replace(pattern, "."),
      raw,
    ).trim();
    if (!sentence) continue;

    const words = distinctive(sentence);
    // A sentence whose every distinctive word has already been said is a
    // restatement, not a new fact.
    const fresh = words.filter((word) => !seen.has(word));
    if (points.length > 0 && fresh.length < 2) continue;

    words.forEach((word) => seen.add(word));
    points.push(tidy(split(sentence)));
  }

  return points;
}

/**
 * The semicolon a point was split on, and the lower-case start it inherited
 * from the middle of a sentence. Punctuation and capitals only — no word of
 * the analyser's is touched.
 */
function tidy(point: Point): Point {
  const text = point.text.replace(/[;,]\s*$/, ".");
  return { ...point, text: text.charAt(0).toUpperCase() + text.slice(1) };
}

/** "Confidence: limited by coverage" and "SUGGESTED zone II" both carry a label. */
function split(sentence: string): Point {
  const colon = /^([A-Z][A-Za-z ]{2,24}):\s*(.+)$/.exec(sentence);
  if (colon) return { label: colon[1], text: colon[2] };

  const shouted = /^([A-Z]{4,})\s+(.+)$/.exec(sentence);
  if (shouted) {
    const label = shouted[1];
    return {
      label: label[0] + label.slice(1).toLowerCase(),
      text: shouted[2],
    };
  }

  return { text: sentence };
}

function distinctive(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !COMMON.has(word));
}
