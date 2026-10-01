import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';
import { computeBadges } from './badges';

type Messages = Record<string, string>;

const EN = en as Messages;
const TR = tr as Messages;

/** The `{name}` slots `interpolate()` in ./i18n.tsx fills, sorted and de-duplicated. */
function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

// Every non-test source file under src/ — the only places a catalog key can be used from.
const SRC_DIR = path.resolve(__dirname, '..');
const code = (readdirSync(SRC_DIR, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => readFileSync(path.join(SRC_DIR, f), 'utf8'))
  .join('\n');

const isLiteral = (text: string) => ["'", '"', '`'].some((q) => code.includes(`${q}${text}${q}`));

const BADGE_IDS: string[] = computeBadges({
  vouchedBy: 0,
  vouchedFor: 0,
  verified: false,
  streakBest: 0,
  tipped: false,
}).map((b) => b.id);

/**
 * Keys assembled at runtime, so no literal in src spells them out. Each entry mirrors one call
 * site: `key` matches what that site can build and captures its runtime part, and `used` checks
 * the code still hands that part in — so a key whose id was dropped still counts as dead.
 */
const DYNAMIC_KEYS: { key: RegExp; used: (id: string) => boolean }[] = [
  // hooks/use-create-profile.ts: messageKey('x') → `onboard.x` or `onboard.claim.x`
  { key: /^onboard\.(?:claim\.)?(\w+)$/, used: (id) => code.includes(`messageKey('${id}')`) },
  // hooks/use-create-profile.ts: `onboard.${from}.restoreNoHandle` / `.restoreNotFound`
  { key: /^onboard\.(\w+)\.restore(?:NoHandle|NotFound)$/, used: isLiteral },
  // components/app/stat-strip.tsx: `statStrip.${tile.key}.label` / `.hint`
  { key: /^statStrip\.(\w+)\.(?:label|hint)$/, used: (id) => code.includes(`key: '${id}'`) },
  // components/BadgeGallery.tsx: `badges.${badge.id}.name` etc., one set per computeBadges() id
  { key: /^badges\.(\w+)\.(?:name|desc|by|next(?:\.one|\.other)?)$/, used: (id) => BADGE_IDS.includes(id) },
  // app/app/people/page.tsx: `people.suggest.mutual.${… ? 'one' : 'other'}`
  { key: /^people\.suggest\.mutual\.(one|other)$/, used: isLiteral },
];

function isReferenced(key: string): boolean {
  if (isLiteral(key)) return true;
  return DYNAMIC_KEYS.some(({ key: pattern, used }) => {
    const id = pattern.exec(key)?.[1];
    return id !== undefined && used(id);
  });
}

describe('message tables (#238, #239)', () => {
  it('keeps en and tr keys in lockstep', () => {
    const onlyInEn = Object.keys(EN).filter((k) => !(k in TR));
    const onlyInTr = Object.keys(TR).filter((k) => !(k in EN));
    expect({ onlyInEn, onlyInTr }).toEqual({ onlyInEn: [], onlyInTr: [] });
  });

  it('gives every key the same placeholders in both locales', () => {
    const mismatched: Record<string, { en: string[]; tr: string[] }> = {};
    for (const key of Object.keys(EN)) {
      if (!(key in TR)) continue; // reported by the lockstep test
      const pair = { en: placeholders(EN[key]), tr: placeholders(TR[key]) };
      if (pair.en.join() !== pair.tr.join()) mismatched[key] = pair;
    }
    expect(mismatched).toEqual({});
  });

  it('has no empty message', () => {
    const blank = (messages: Messages) =>
      Object.keys(messages).filter((k) => typeof messages[k] !== 'string' || messages[k].trim() === '');
    expect({ en: blank(EN), tr: blank(TR) }).toEqual({ en: [], tr: [] });
  });

  it('references every key from src', () => {
    expect(Object.keys(EN).filter((k) => !isReferenced(k))).toEqual([]);
  });

  it('has every money-flow string in both locales', () => {
    const prefixes = ['tip.', 'quests.', 'rewards.', 'unlockables.'];
    const keys = Object.keys(EN).filter((k) => prefixes.some((p) => k.startsWith(p)));
    // tip/quests/rewards/unlockables — the four untranslated surfaces from #238.
    expect(keys.length).toBeGreaterThan(80);
    for (const k of keys) {
      expect(EN[k], `en ${k}`).toBeTruthy();
      expect(TR[k], `tr ${k}`).toBeTruthy();
    }
  });
});
