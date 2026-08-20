// Compatibility port pinned to CubityFirst/rngdle-ep-calculator
// commit 8d330f5dcf674b80d5badb7d1e58ba1cc74d8fab.
// Use and adaptation authorized by the repository owner's permission, as
// confirmed by the Bitedle maintainer on 2026-08-19.
// Kept isolated so it can be replaced by a reviewed declarative catalog.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { PROBABILITIES } from "./probabilities.gen.js";
// RNGdle badge / EP calculator - Cloudflare Worker
//
// Enter any number 0..1000000 and get the total EP plus the list of badges it earns.
// EP per badge = the "Score (Decimal)" column from the source CSV.
//
// The badge `test` functions and the FAMILIES map are reconciled to full parity with the
// live game: every number 0..1,000,000 yields the identical earned/scoring badges and total
// EP as rngdle.com (see README.md and test/full-membership.mjs).

// Beta renderer only: per-badge digit "contributors" (which positions each badge
// highlights). Generated from the rngdle.com bundle (test/gen-contributors.mjs).
// Does NOT affect EP math; compute() below stays the single source of truth.
// rngdle.com's exact EP -> percentile table (test/gen-percentiles.mjs), for the
// beta card's "TOP X%". Replaces the borrowed neocities curve fit with real data.
// Full-scan snapshot data (research/gen-snapshot.mjs, `npm run gen`): example
// numbers per badge for the /badges index, and each badge's exact share of all
// 1,000,001 inputs. Regenerate + commit whenever a badge test / EP / family changes.
// Shared design system: one token set, one set of primitives (.btn/.field/.pill/.card/
// .stat/.kv/.progress) and one site nav, used by every page below. See src/ui.js.
// /beta - the experimental data-vis lab. Its pages render from the same badge table and
// the same client-side sweep as everything else; betaCtx() below is the one hand-off.

// Palette gallery for /beta/boxes - the only route that reads or writes storage.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ipow(b, e) { let r = 1; for (let i = 0; i < e; i++) r *= b; return r; }

// Perfect b^exp. 0 and 1 both count as perfect powers of every exponent (0 = 0^exp,
// 1 = 1^exp) and earn all 13 power badges (superseded to the top tier). Both confirmed
// against prod: 0 = 139,927,162, 1 = 162,575,449.
function isPerfectPower(n, exp) {
  if (n <= 1) return true;
  for (let b = 2; ; b++) {
    const v = ipow(b, exp);
    if (v > n) return false;
    if (v === n) return true;
  }
}

// k^m for m >= 1 (so 1 is NOT counted as a power of k).
function isPowerOf(n, k) {
  if (n < k) return false;
  let v = k;
  while (v < n) v *= k;
  return v === n;
}

const FACTORIALS = new Set([1, 2, 6, 24, 120, 720, 5040, 40320, 362880]); // 0!..9! within range
const FIBS = (() => {
  const s = new Set([0, 1]);
  let a = 0, b = 1;
  while (b <= 1000000) { s.add(b); [a, b] = [b, a + b]; }
  return s;
})();
const PRONICS = (() => {
  const s = new Set();
  for (let k = 0; k * (k + 1) <= 1000000; k++) s.add(k * (k + 1));
  return s;
})();

function isPrime(n) {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

// Partition a string into `count` non-empty contiguous parts.
function partitions(str, count) {
  const res = [];
  (function rec(start, parts) {
    if (parts.length === count) { if (start === str.length) res.push(parts.slice()); return; }
    const remaining = count - parts.length;
    for (let end = start + 1; end <= str.length - (remaining - 1); end++) {
      parts.push(str.slice(start, end));
      rec(end, parts);
      parts.pop();
    }
  })(0, []);
  return res;
}
const validPart = p => p.length === 1 || p[0] !== '0'; // no leading zeros except "0"

// Can `str` split into `count` parts that are consecutive integers ascending in order?
// multiDigit: require at least one part to be 2+ digits (so single-digit runs like
// "12" are NOT counted as "consecutive numbers" - those are Neighbors instead).
function consecAsc(str, count, multiDigit) {
  for (const parts of partitions(str, count)) {
    if (!parts.every(validPart)) continue;
    if (multiDigit && !parts.some(p => p.length >= 2)) continue;
    const nums = parts.map(Number);
    let ok = true;
    for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] !== 1) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}
// Can `str` split into `count` consecutive integers but NOT in ascending order?
function consecScrambled(str, count) {
  for (const parts of partitions(str, count)) {
    if (!parts.every(validPart)) continue;
    const nums = parts.map(Number);
    const sorted = [...nums].sort((a, b) => a - b);
    let isSet = true;
    for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] !== 1) { isSet = false; break; }
    if (!isSet) continue;
    let asc = true;
    for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] !== 1) { asc = false; break; }
    if (!asc) return true;
  }
  return false;
}
// Does any contiguous substring split into `count` consecutive integers ascending?
function containsConsec(str, count, multiDigit) {
  const minLen = count; // each part >= 1 digit
  for (let i = 0; i < str.length; i++)
    for (let j = i + minLen; j <= str.length; j++)
      if (consecAsc(str.slice(i, j), count, multiDigit)) return true;
  return false;
}
// Two non-adjacent substrings that are consecutive integers (a then a+1, with a gap between).
// multiDigit: at least one of the two must be 2+ digits.
function pairNearby(s, multiDigit) {
  const subs = [];
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j <= s.length; j++) {
      const t = s.slice(i, j);
      if (validPart(t)) subs.push({ v: Number(t), i, j });
    }
  for (const a of subs)
    for (const b of subs) {
      if (a.j <= b.i && b.i - a.j >= 1 && b.v === a.v + 1) {
        if (!multiDigit || (a.j - a.i >= 2 || b.j - b.i >= 2)) return true;
      }
    }
  return false;
}

// Contiguous ascending run of L consecutive digits (each +1).
function seqAsc(d, L) {
  for (let i = 0; i + L <= d.length; i++) {
    let ok = true;
    for (let k = 1; k < L; k++) if (d[i + k] - d[i + k - 1] !== 1) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}
// Contiguous run of L consecutive digits, ascending OR descending.
function straightRun(d, L) {
  for (let i = 0; i + L <= d.length; i++) {
    let asc = true, desc = true;
    for (let k = 1; k < L; k++) {
      if (d[i + k] - d[i + k - 1] !== 1) asc = false;
      if (d[i + k] - d[i + k - 1] !== -1) desc = false;
    }
    if (asc || desc) return true;
  }
  return false;
}

function mountain(d) {
  const n = d.length; if (n < 3) return false;
  let i = 0;
  while (i + 1 < n && d[i] < d[i + 1]) i++;
  if (i === 0 || i === n - 1) return false;
  while (i + 1 < n && d[i] > d[i + 1]) i++;
  return i === n - 1;
}
function valley(d) {
  const n = d.length; if (n < 3) return false;
  let i = 0;
  while (i + 1 < n && d[i] > d[i + 1]) i++;
  if (i === 0 || i === n - 1) return false;
  while (i + 1 < n && d[i] < d[i + 1]) i++;
  return i === n - 1;
}
function hills(d) {
  if (d.length < 3) return false;
  let prev = 0;
  for (let i = 1; i < d.length; i++) {
    const diff = d[i] - d[i - 1];
    if (diff === 0) return false;
    const sign = diff > 0 ? 1 : -1;
    if (prev !== 0 && sign === prev) return false;
    prev = sign;
  }
  return true;
}
const strictInc = d => { for (let i = 1; i < d.length; i++) if (d[i] <= d[i - 1]) return false; return d.length >= 2; };
const strictDec = d => { for (let i = 1; i < d.length; i++) if (d[i] >= d[i - 1]) return false; return d.length >= 2; };
const consecInc = d => { for (let i = 1; i < d.length; i++) if (d[i] - d[i - 1] !== 1) return false; return d.length >= 2; };
const consecDec = d => { for (let i = 1; i < d.length; i++) if (d[i] - d[i - 1] !== -1) return false; return d.length >= 2; };
const arithmetic = d => { if (d.length < 3) return false; const diff = d[1] - d[0]; for (let i = 2; i < d.length; i++) if (d[i] - d[i - 1] !== diff) return false; return true; };
const absArith = d => { if (d.length < 3) return false; const a = Math.abs(d[1] - d[0]); for (let i = 2; i < d.length; i++) if (Math.abs(d[i] - d[i - 1]) !== a) return false; return true; };
const turtle = d => { if (d.length < 2) return false; for (let i = 1; i < d.length; i++) if (Math.abs(d[i] - d[i - 1]) > 1) return false; return true; };
const alternator = d => { if (d.length < 2) return false; for (let i = 1; i < d.length; i++) if (d[i] % 2 === d[i - 1] % 2) return false; return true; };
const allSameParity = d => { if (d.length < 1) return false; const p = d[0] % 2; return d.every(x => x % 2 === p); };

// Lengths of maximal runs of identical digits, e.g. "455000" -> [1, 2, 3].
function runLengths(s) {
  const r = [];
  let i = 0;
  while (i < s.length) { let j = i; while (j < s.length && s[j] === s[i]) j++; r.push(j - i); i = j; }
  return r;
}

function strobogrammatic(s) {
  const map = { '0': '0', '1': '1', '6': '9', '8': '8', '9': '6' };
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) { const m = map[s[i]]; if (m === undefined) return false; out += m; }
  return out === s;
}

// ---------------------------------------------------------------------------
// Prod-ported helpers: transcribed (faithful semantics) from the live game's
// BADGE_DEFINITIONS util module so the consecutive / sequence / contiguous-pair
// badges match rngdle.com byte-for-byte. Do not "simplify" without re-checking
// parity (test/divergence.mjs). These operate on the raw digit string.
// ---------------------------------------------------------------------------
function pLeadingZero(s) { return s.length > 1 && s[0] === '0'; }
function pMultiPart(parts) { return parts.some(p => p.length >= 2); }
function pConsecSet(nums) { const t = [...nums].sort((a, b) => a - b); for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] !== 1) return false; return true; }
function pDigitCounts(s) { const m = new Map(); for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1); return m; }
function pContig(s, digit, count) { return s.includes(digit.repeat(count)); }
function pOrdered(nums) { if (nums.length < 2) return true; let inc = true, dec = true; for (let i = 1; i < nums.length; i++) { if (nums[i] <= nums[i - 1]) inc = false; if (nums[i] >= nums[i - 1]) dec = false; } return inc || dec; }
function pHasSequence(s, len, strictAsc = true) {
  if (s.length < len || len <= 0) return false;
  for (let i = 0; i <= s.length - len; i++) {
    const a = s.charCodeAt(i);
    if (strictAsc) {
      let ok = true; for (let k = 1; k < len; k++) if (s.charCodeAt(i + k) !== a + k) { ok = false; break; }
      if (ok) return true;
    } else {
      const dir = s.charCodeAt(i + 1) - a;
      if (dir === 1 || dir === -1) { let ok = true; for (let k = 1; k < len; k++) if (s.charCodeAt(i + k) !== a + k * dir) { ok = false; break; } if (ok) return true; }
    }
  }
  return false;
}
function pPairExact(s) {
  for (let t = 1; t < s.length; t++) {
    const i = s.slice(0, t), r = s.slice(t);
    if (pLeadingZero(i) || pLeadingZero(r) || !pMultiPart([i, r])) continue;
    const a = parseInt(i, 10), b = parseInt(r, 10);
    if (Math.abs(a - b) === 1) return { numbers: [a, b], splits: [0, t] };
  }
  return null;
}
// pTripleExact / pQuadExact are each asked for by TWO badges (in-order + scrambled) about
// the same string, so every second call is a guaranteed repeat - a one-entry cache halves
// the cost of the four most expensive badges in the full-range sweep. The cache lives on
// the function object rather than in module scope because these helpers are shipped to the
// browser engine via Function.prototype.toString(), which only carries the body.
function pTripleExact(s) {
  if (pTripleExact.k !== s) { pTripleExact.k = s; pTripleExact.v = pTripleExactScan(s); }
  return pTripleExact.v;
}
function pQuadExact(s) {
  if (pQuadExact.k !== s) { pQuadExact.k = s; pQuadExact.v = pQuadExactScan(s); }
  return pQuadExact.v;
}
function pTripleExactScan(s) {
  for (let t = 1; t < s.length - 1; t++) for (let i = t + 1; i < s.length; i++) {
    const parts = [s.slice(0, t), s.slice(t, i), s.slice(i)];
    if (parts.some(pLeadingZero) || !pMultiPart(parts)) continue;
    const nums = parts.map(p => parseInt(p, 10));
    if (pConsecSet(nums)) return { numbers: nums, splits: [0, t, i] };
  }
  return null;
}
function pQuadExactScan(s) {
  for (let t = 1; t < s.length - 2; t++) for (let i = t + 1; i < s.length - 1; i++) for (let r = i + 1; r < s.length; r++) {
    const parts = [s.slice(0, t), s.slice(t, i), s.slice(i, r), s.slice(r)];
    if (parts.some(pLeadingZero) || !pMultiPart(parts)) continue;
    const nums = parts.map(p => parseInt(p, 10));
    if (pConsecSet(nums)) return { numbers: nums, splits: [0, t, i, r] };
  }
  return null;
}
function pPairAdjacent(s) {
  for (let t = 0; t < s.length; t++) for (let i = 1; i <= s.length - t - 1; i++) {
    const r = s.slice(t, t + i); if (pLeadingZero(r)) continue;
    const a = parseInt(r, 10);
    for (const v of [a + 1, a - 1]) {
      if (v < 0) continue;
      const ns = v.toString(), o = t + i + ns.length; if (o > s.length) continue;
      const seg = s.slice(t + i, o);
      if (seg === ns && pMultiPart([r, seg])) { if (t === 0 && o === s.length) continue; return { numbers: [a, v], splits: [t, t + i], start: t }; }
    }
  }
  return null;
}
function pPairNearby(s) {
  const subs = [];
  for (let i = 0; i < s.length; i++) for (let r = 1; r <= s.length - i; r++) { const a = s.slice(i, i + r); if (!pLeadingZero(a)) subs.push({ value: parseInt(a, 10), start: i, end: i + r, str: a }); }
  for (let e = 0; e < subs.length; e++) for (let i = e + 1; i < subs.length; i++) {
    const r = subs[e], a = subs[i];
    if (Math.abs(r.value - a.value) === 1 && pMultiPart([r.str, a.str]) &&
        ((!(r.end > a.start) && !(a.end > r.start)) || r.end <= a.start || a.end <= r.start) &&
        r.end !== a.start && a.end !== r.start) return { a: r, b: a };
  }
  return null;
}
function pNAdjacentBuild(s, start, firstLen, firstVal, dir, count) {
  const numbers = [firstVal], splits = [start]; let cursor = start + firstLen; const parts = [s.slice(start, start + firstLen)];
  for (let k = 1; k < count; k++) {
    const v = firstVal + k * dir; if (v < 0) return null;
    const vs = v.toString(); if (cursor + vs.length > s.length) return null;
    const seg = s.slice(cursor, cursor + vs.length); if (seg !== vs) return null;
    numbers.push(v); splits.push(cursor); parts.push(seg); cursor += vs.length;
  }
  return pMultiPart(parts) ? { numbers, splits, start, end: cursor } : null;
}
function pNAdjacentAt(s, count, start) {
  if (count < 2) return null;
  for (let len = 1; len <= s.length - start - (count - 1); len++) {
    const part = s.slice(start, start + len); if (pLeadingZero(part)) continue;
    const val = parseInt(part, 10);
    const up = pNAdjacentBuild(s, start, len, val, 1, count); if (up) return up;
    const down = pNAdjacentBuild(s, start, len, val, -1, count); if (down) return down;
  }
  return null;
}
function pNAdjacent(s, count) {
  for (let i = 0; i < s.length; i++) {
    const r = pNAdjacentAt(s, count, i);
    if (r) { if (r.start === 0 && r.end === s.length) continue; return r; }
  }
  return null;
}
// Start indices of "contiguous pairs": a digit that occurs EXACTLY twice in the whole
// number, with both occurrences adjacent ("dd"). Contiguous Two/Three Pair then look for
// 2 or 3 of these starting exactly 2 apart (ddee / ddeeff).
function pContigPairStarts(s) {
  const counts = pDigitCounts(s);
  const starts = [];
  for (const [digit, n] of counts.entries()) {
    if (n === 2 && pContig(s, digit, 2)) {
      for (let t = 0; t < s.length - 1; t++) if (s[t] === digit && s[t + 1] === digit) { starts.push(t); break; }
    }
  }
  starts.sort((a, b) => a - b);
  return starts;
}

// ---------------------------------------------------------------------------
// Prod-ported helpers for the 2026-07-16 badge batch (Metronome / Crescendo /
// Equation / Pocket Mirror / Mini Scramble). Transcribed from the live game's
// BADGE_DEFINITIONS util module (research/rngdle-dump-2026-07-16), so these
// match rngdle.com. Verified against each badge's shipped match/reject cases and
// the published earn-probabilities. Do not "simplify" without re-checking parity.
// ---------------------------------------------------------------------------

// Partition `s` into exactly `count` non-empty parts (no leading zeros) and test
// pred(numbers); returns {splits, numbers} for the first passing split or null. (prod `_`)
function pSplitParts(s, count, pred) {
  const splits = Array(count), nums = Array(count);
  const rec = (idx, start) => {
    if (idx === count - 1) {
      const part = s.slice(start);
      if (pLeadingZero(part)) return false;
      splits[idx] = start; nums[idx] = Number(part);
      return pred(nums);
    }
    const remaining = count - idx - 1;
    for (let end = start + 1; end <= s.length - remaining; end++) {
      const part = s.slice(start, end);
      if (pLeadingZero(part)) continue;
      splits[idx] = start; nums[idx] = Number(part);
      if (rec(idx + 1, end)) return true;
    }
    return false;
  };
  return rec(0, 0) ? { splits: [...splits], numbers: [...nums] } : null;
}
// 3+ parts forming an arithmetic sequence with common difference d where |d| >= 2
// (a diff of 0/±1 is Homogeneous / Cascade / Waterfall, not "Metronome"). (prod `S`)
function findArithmeticSplit(s) {
  for (let count = 3; count <= s.length; count++) {
    const r = pSplitParts(s, count, nums => {
      const diff = nums[1] - nums[0];
      if (diff === -1 || diff === 0 || diff === 1) return false;
      for (let i = 2; i < nums.length; i++) if (nums[i] - nums[i - 1] !== diff) return false;
      return true;
    });
    if (r) return r;
  }
  return null;
}
// 3+ positive parts forming a geometric sequence (constant ratio via b^2 = a*c). (prod `A`)
function findGeometricSplit(s) {
  for (let count = 3; count <= s.length; count++) {
    const r = pSplitParts(s, count, nums => {
      if (nums.some(v => v <= 0) || nums[0] === nums[1]) return false;
      for (let t = 0; t + 2 < nums.length; t++) if (nums[t + 1] * nums[t + 1] !== nums[t] * nums[t + 2]) return false;
      return true;
    });
    if (r) return r;
  }
  return null;
}
// Splits into 3 non-zero parts a,b,c where inserting one of + - * / makes a op b === c. (prod `w`)
function findEquation(s) {
  return pSplitParts(s, 3, nums => {
    const [a, b, c] = nums;
    if (a === 0 || b === 0 || c === 0) return false;
    return a + b === c || a - b === c || a * b === c || (a % b === 0 && a / b === c);
  });
}
// Plain string palindrome (used by Pocket Mirror over substrings). (prod `r`)
function isPalindromeStr(s) { for (let i = 0, j = s.length - 1; i < j; i++, j--) if (s[i] !== s[j]) return false; return true; }
// `s` has >= minLen digits that, sorted ascending, form a run of consecutive values. (prod `N`)
function isScrambledSeq(s, minLen) {
  if (s.length < minLen) return false;
  const arr = [...s].map(Number).sort((a, b) => a - b);
  for (let i = 1; i < arr.length; i++) if (arr[i] !== arr[i - 1] + 1) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Badge definitions: [id, label, emoji, ep, test(c)]
// c = { n, s, len, d, counts, distinct, sum, prod, maxCount, has(sub), cnt(digit), withCount(k) }
//
// Rarity is NOT stored per-badge. Like rngdle.com, it is derived from the badge's
// EP score via the BADGE_RARITY_THRESHOLDS cutoffs (reverse-engineered from the
// shipped chunk_6d375db2482ce7e8.js: getBadgeRarityTier). Any future EP change
// therefore keeps rarity self-correcting - no second value to forget.
// ---------------------------------------------------------------------------

const BADGE_RARITY_THRESHOLDS = { common: 1e3, uncommon: 1e4, rare: 1e5, epic: 1e6, anomaly: 1e7 };

// Returns rarity tier (lowercase) for a given EP score, matching rngdle.com.
export function tierFromScore(ep) {
  const t = BADGE_RARITY_THRESHOLDS;
  return ep < t.common ? 'common'
       : ep < t.uncommon ? 'uncommon'
       : ep < t.rare ? 'rare'
       : ep < t.epic ? 'epic'
       : ep < t.anomaly ? 'anomaly'
       : 'mythic';
}

// Capitalized rarity label (used in tooltips / exports / pill rendering).
export function rarityFromScore(ep) {
  const t = tierFromScore(ep);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const BADGES = [
  // --- Mythic exacts ---
  ['NICE_EXACT', 'Exact Nice', '😏', 100000100, c => c.n === 69],
  ['JACKPOT_EXACT', 'Exact Jackpot', '💰', 100000100, c => c.n === 777],
  ['JACKPOT_SIX', 'Jackpot Six', '🏦', 100000100, c => c.has('777777')],
  ['BOTANIST_EXACT', 'Exact Botanist', '🌿', 100000100, c => c.n === 420],
  ['DEVIL_EXACT', 'Exact Devil', '😈', 100000100, c => c.n === 666],
  ['LEET_EXACT', 'Exact Leet', '💻', 100000100, c => c.n === 1337],
  ['EXACT_HELL', 'Exact Hell', '👹', 100000100, c => c.n === 7734],
  ['EXACT_BOOB_80085', 'Exact 80085', '💎', 100000100, c => c.n === 80085],
  ['MEANING_EXACT', 'Exact Meaning', '🌌', 100000100, c => c.n === 42],
  ['EMERGENCY_EXACT', 'Exact Emergency', '🚑', 100000100, c => c.n === 911],
  ['VERY_VERY_NICE', 'Very Very Nice', '😏', 100000100, c => c.n === 696969],
  ['HOTBOX', 'Hotbox', '🌿', 100000100, c => c.n === 420420],
  ['MAYDAY', 'Mayday', '🚑', 100000100, c => c.n === 911911],
  ['UNIVERSAL_ANSWER', 'Universal Answer', '🌌', 100000100, c => c.n === 424242],
  ['BIG_BROTHER_EXACT', 'Orwellian', '👁️', 100000100, c => c.n === 1984],
  ['DIGIT_ZERO', 'Zero', '0️⃣', 100000100, c => c.n === 0],
  ['DIGIT_ONE', 'One', '1️⃣', 100000100, c => c.n === 1],
  ['DIGIT_TWO', 'Two', '2️⃣', 100000100, c => c.n === 2],
  ['DIGIT_THREE', 'Three', '3️⃣', 100000100, c => c.n === 3],
  ['DIGIT_FOUR', 'Four', '4️⃣', 100000100, c => c.n === 4],
  ['DIGIT_FIVE', 'Five', '5️⃣', 100000100, c => c.n === 5],
  ['DIGIT_SIX', 'Six', '6️⃣', 100000100, c => c.n === 6],
  ['DIGIT_SEVEN', 'Seven', '7️⃣', 100000100, c => c.n === 7],
  ['DIGIT_EIGHT', 'Eight', '8️⃣', 100000100, c => c.n === 8],
  ['DIGIT_NINE', 'Nine', '9️⃣', 100000100, c => c.n === 9],
  ['TREE_FIDDY_EXACT', 'Exact Tree Fiddy', '🦕', 100000100, c => c.n === 350],
  ['SIXTY_SEVEN_EXACT', 'Exact Six-Seven', '🫠', 100000100, c => c.n === 67],
  ['EIGHTY_SIX_EXACT', 'Exact Eighty-Six', '🍽️', 100000100, c => c.n === 86],
  ['ORIENTATION_EXACT', 'Exact Orientation', '🧭', 100000100, c => c.n === 101],
  ['CALENDAR_EXACT', 'Exact Calendar', '📅', 100000100, c => c.n === 365],
  ['BRAINROT', 'Brainrot', '🫠', 100000100, c => c.n === 676767],
  ['GROUNDHOG_DAY', 'Groundhog Day', '📅', 100000100, c => c.n === 365365],
  ['ONE_MILLION', 'One Million', '🐐', 100000100, c => c.n === 1000000],
  ['ERROR_EXACT', 'Not Found', '🚫', 100000100, c => c.n === 404],
  ['FULL_DAY', 'Full Day', '⏳', 100000100, c => c.n === 86400],
  ['FOOTBALL_17776', '17776', '🏈', 100000100, c => c.n === 17776],
  ['INFERNAL', 'Infernal', '🔱', 100000100, c => c.n === 666666],
  ['ALWAYS', 'Always', '♾️', 50000050, c => c.s === '247365' || c.s === '365247'],
  ['ULTIMEME_EXACT', 'Funny Number', '😂', 50000050, c => c.s === '69420' || c.s === '42069'],
  ['EXACT_BOOB', 'Exact Boob', '🍈', 50000050, c => c.n === 8008 || c.n === 58008],

  // --- Powers / math (Mythic/Anomaly) ---
  ['THIRTEENTH_POWER', '13th Power', '💀', 33333367, c => isPerfectPower(c.n, 13)],
  ['SEVENTEENTH_POWER', '17th Power', '🧙', 33333367, c => isPerfectPower(c.n, 17)],
  ['NINETEENTH_POWER', '19th Power', '🌑', 33333367, c => isPerfectPower(c.n, 19)],
  ['TAU', 'Tau', '🌀', 33333367, c => c.s === '6283' || c.s === '62831' || c.s === '628318'],
  ['GOLDEN_RATIO', 'Golden Ratio', '🐚', 33333367, c => c.s === '1618' || c.s === '16180' || c.s === '161803'],
  ['TENTH_POWER', '10th Power', '🔟', 25000025, c => isPerfectPower(c.n, 10)],
  ['ELEVENTH_POWER', '11th Power', '🕚', 25000025, c => isPerfectPower(c.n, 11)],
  ['PI', 'Pi', '🥧', 25000025, c => [314, 3141, 31415, 314159].includes(c.n)],
  ['E', "Euler's Number", '📈', 25000025, c => [271, 2718, 27182, 271828].includes(c.n)],
  ['CONSEC_QUAD_EXACT', '4 Consecutive Numbers', '⛓️', 25000025, c => { const r = pQuadExact(c.s); return !!r && pOrdered(r.numbers); }],
  ['NINTH_POWER', '9th Power', '☁️', 20000020, c => isPerfectPower(c.n, 9)],
  ['EIGHTH_POWER', '8th Power', '🎱', 16666683, c => isPerfectPower(c.n, 8)],
  ['OUROBOROS', 'Ouroboros', '🐍', 14285729, c => c.n === 1 || c.n === 4 || c.n === 27 || c.n === 256 || c.n === 3125 || c.n === 46656 || c.n === 823543],
  ['SEVENTH_POWER', '7th Power', '🌈', 12500013, c => isPerfectPower(c.n, 7)],
  ['POWER_OF_SEVEN', 'Power of Seven', '7️⃣', 12500013, c => { if (c.n <= 0) return false; let v = 1; while (v < c.n) v *= 7; return v === c.n; }],
  ['FACTORIAL', 'Factorial', '❗', 11111122, c => FACTORIALS.has(c.n)],
  ['POWER_OF_FIVE', 'Power of Five', '5️⃣', 11111122, c => { if (c.n <= 0) return false; let v = 1; while (v < c.n) v *= 5; return v === c.n; }],
  ['HELLO', 'Hello', '👋', 11111122, c => c.has('07734')],
  ['SEQUENCE_6', 'Sequence (6)', '🔢', 11111122, c => pHasSequence(c.s, 6, false)],
  ['CONTIGUOUS_SIXES', 'Contiguous Sixes', '➖➖➖➖', 10000010, c => /(\d)\1{5}/.test(c.s)],
  ['DEEP_VOID_FIVE', 'Deep Void (5)', '⚫', 10000010, c => c.has('00000')],
  ['ONE_DIGIT', 'Single Digit', '☝️', 10000010, c => c.len === 1],
  ['QUINT_NINE', 'Quint Nine', '🥳', 10000010, c => c.s.endsWith('99999')],
  ['SIXTH_POWER', '6th Power', '🎲', 9090918, c => isPerfectPower(c.n, 6)],
  ['POWER_OF_THREE', 'Power of Three', '🔺', 7692315, c => { if (c.n <= 0) return false; let v = 1; while (v < c.n) v *= 3; return v === c.n; }], // prod: 1 (=3^0) counts
  ['FIFTH_POWER', '5th Power', '🖐️', 6250006, c => isPerfectPower(c.n, 5)],
  ['JACKPOT_FIVE', 'Jackpot Five', '💰💰💰', 5263163, c => c.has('77777')],
  ['POWER_OF_TWO', 'Power of Two', '💾', 5000005, c => c.n > 0 && (c.n & (c.n - 1)) === 0], // prod: 1 (=2^0) counts
  ['ROYAL_FLUSH', 'Royal Flush', '👑', 5000005, c => c.has('56789')],
  ['BOOB_58008', '58008', '🔠', 5000005, c => c.has('58008')],
  ['BOOB_80085', '80085', '🅱️', 5000005, c => c.has('80085')],
  ['PI_CONTAINS_5', 'Pi Slice (5)', '🥧', 5000005, c => c.has('31415')],
  ['E_CONTAINS_5', 'E Slice (5)', '📈', 5000005, c => c.has('27182')],
  ['TAU_SLICE_5', 'Tau Slice (5)', '🌀', 5000005, c => c.has('62831')],
  ['CASCADE', 'Cascade', '🌊', 3333337, c => consecInc(c.d)],
  ['FIBONACCI', 'Fibonacci Number', '🐚', 3333337, c => FIBS.has(c.n)],
  ['FOURTH_POWER', '4th Power', '📦', 3125003, c => isPerfectPower(c.n, 4)],
  ['WATERFALL', 'Waterfall', '🚿', 2857146, c => consecDec(c.d)],
  ['CONSEC_QUAD_CONTAINS', '4 Consecutive Numbers (Contains)', '🔗', 2631582, c => pNAdjacent(c.s, 4) !== null],
  ['CONSEC_QUAD_SCRAMBLED', '4 Consecutive Numbers (Scrambled)', '🔀', 2272730, c => { const r = pQuadExact(c.s); return !!r && !pOrdered(r.numbers); }],
  ['HOMOGENEOUS', 'Homogeneous', '🥛', 2222224, c => c.len >= 2 && c.distinct === 1],
  ['ULTIMEME', 'Funny Numbers', '😂', 1666668, c => c.has('69') && c.has('420')],
  ['BINARY_SOUL', 'Binary Soul', '🤖', 1538463, c => /^[01]+$/.test(c.s)],
  ['STRAIGHT_FLUSH', 'Straight Flush', '🃏', 1449277, c => c.has('02468') || c.has('13579') || c.has('86420') || c.has('97531')],
  ['TWO_DIGITS', 'Two Digits', '✌️', 1111112, c => c.len === 2],
  // sum === product. Excludes single digits (1..9 are trivially true) but prod DOES
  // award it to 0 (sum 0 = product 0), so 0 is allowed through. Confirmed via 0 vs 2.
  ['SPY', 'Spy Number', '🕵️', 1030929, c => c.n !== 1 && c.n !== 2 && c.sum === c.prod], // prod excludes only 1 and 2
  ['QUAD_NINE', 'Quad Nine', '🎊', 1000001, c => c.s.endsWith('9999')],
  ['SEMI_EPOCH', 'Semi-Epoch', '🗿', 1000001, c => c.s.endsWith('5000')],
  ['CUBE', '3rd Power', '🧊', 990100, c => isPerfectPower(c.n, 3)],
  ['EVEN_SPACING', 'Even Spacing', '📏', 862070, c => arithmetic(c.d)],

  // --- Epic ---
  ['CONSEC_TRIPLE_EXACT', '3 Consecutive Numbers', '⛓️', 555556, c => { const r = pTripleExact(c.s); return !!r && pOrdered(r.numbers); }],
  ['CONTIGUOUS_FIVES', 'Contiguous Fives', '➖➖➖', 552487, c => /(\d)\1{4}/.test(c.s)],
  ['DEEP_VOID_FOUR', 'Deep Void (4)', '🌌', 552487, c => c.has('0000')],
  ['STROBOGRAMMATIC', 'Strobogrammatic', '🙃', 502513, c => strobogrammatic(c.s)],
  ['STRAIGHT', 'Straight', '📏', 454546, c => straightRun(c.d, 5)],
  ['JACKPOT_FOUR', 'Jackpot Four', '💰💰', 357143, c => c.has('7777')],
  ['VERY_NICE', 'Very Nice', '🥵', 334448, c => c.has('6969')],
  ['DEEPER_MEANING', 'Deeper Meaning', '🌌', 334448, c => c.has('4242')],
  ['SIXTY_SEVEN_DOUBLE', '6767', '🫠', 334448, c => c.has('6767')],
  ['LEET', 'Leet', '💻', 333334, c => c.has('1337')],
  ['HELL', 'Hell', '🔥', 333334, c => c.has('7734')],
  ['BOOB_8008', '8008', '🔢', 333334, c => c.has('8008')],
  ['BIG_BROTHER', 'Big Brother', '👁️', 333334, c => c.has('1984')],
  ['PI_CONTAINS_4', 'Pi Slice (4)', '🥧', 333334, c => c.has('3141')],
  ['E_CONTAINS_4', 'E Slice (4)', '📈', 333334, c => c.has('2718')],
  ['TAU_SLICE_4', 'Tau Slice (4)', '🌀', 333334, c => c.has('6283')],
  ['CONSEC_TRIPLE_SCRAMBLED', '3 Consecutive Numbers (Scrambled)', '🔀', 277778, c => { const r = pTripleExact(c.s); return !!r && !pOrdered(r.numbers); }],
  ['ZIPPER', 'Zipper', '🤐', 246914, c => c.len >= 2 && c.distinct === 2 && c.d.every((x, i) => i === 0 || x !== c.d[i - 1])],
  ['ASCENSION', 'Ascension', '📈', 219298, c => strictInc(c.d)],
  ['GEOMETRIC', 'Crescendo', '🔊', 208334, c => findGeometricSplit(c.s) !== null],
  ['FIVE_OF_A_KIND', 'Five of a Kind', '🃏', 198020, c => c.maxCount >= 5],
  ['CONSEC_TRIPLE_CONTAINS', '3 Consecutive Numbers (Contains)', '🔗', 157978, c => pNAdjacent(c.s, 3) !== null],
  ['CONTIGUOUS_THREE_PAIR', 'Contiguous Three Pair', '👨‍👩‍👧‍👦👯', 154321, c => { const a = pContigPairStarts(c.s); for (let i = 0; i < a.length - 2; i++) if (a[i] + 2 === a[i + 1] && a[i + 1] + 2 === a[i + 2]) return true; return false; }],
  ['FRAMED_PAIR', 'Framed Pair', '🖼️', 137174, c => c.len === 4 && c.d[1] === c.d[2] && c.d[0] !== c.d[1] && c.d[3] !== c.d[1]],
  ['FRAMED_TRIPLE', 'Framed Triple', '🖼️🖼️', 137174, c => c.len === 5 && c.d[1] === c.d[2] && c.d[2] === c.d[3] && c.d[0] !== c.d[1] && c.d[4] !== c.d[1]],
  ['FRAMED_QUAD', 'Framed Quad', '🪟', 137174, c => c.len === 6 && c.d[1] === c.d[2] && c.d[2] === c.d[3] && c.d[3] === c.d[4] && c.d[0] !== c.d[1] && c.d[5] !== c.d[4]],
  ['DECAY', 'Decay', '📉', 119474, c => strictDec(c.d)],
  ['THREE_DIGITS', 'Three Digits', '🤟', 111111, c => c.len === 3],
  ['ECHO', 'Echo', '📣', 100100, c => c.len >= 2 && c.len % 2 === 0 && c.s.slice(0, c.len / 2) === c.s.slice(c.len / 2)],
  ['MILLENNIUM', 'Millennium', '🗓️', 100000, c => c.s.endsWith('000')],
  ['PRONIC', 'Pronic Number', '🧮', 100000, c => PRONICS.has(c.n)],
  ['TRIPLE_NINE', 'Triple Nine', '🎉', 100000, c => c.s.endsWith('999')],
  ['SEMI_MILLENNIUM', 'Semi-Millennium', '📜', 100000, c => c.s.endsWith('500')],
  ['COLOSSAL', 'Colossal', '🪨', 100000, c => c.n > 999000],
  ['SQUARE', '2nd Power', '🟦', 99900, c => isPerfectPower(c.n, 2)],
  ['EVEN_SPACING_ABS', 'Even Spacing (Absolute)', '📐', 90992, c => absArith(c.d)],
  ['FIREFLY', 'Firefly', '🪲', 82237, c => {
    if (c.len < 4 || c.distinct !== 2) return false; // prod requires length >= 4
    return Object.values(c.counts).some(v => v === 1); // one digit appears exactly once
  }],
  ['CONSEC_PAIR_EXACT', '2 Consecutive Numbers', '🔗', 50505, c => pPairExact(c.s) !== null],
  ['PALINDROME', 'Palindrome', '🪞', 50025, c => c.s === [...c.s].reverse().join('')],

  // --- Rare ---
  ['CONTIGUOUS_QUADS', 'Contiguous Quads', '➖➖', 37023, c => /(\d)\1{3}/.test(c.s)],
  ['DEEP_VOID_THREE', 'Deep Void (3)', '🌑', 37023, c => c.has('000')],
  ['TURTLE', 'Turtle', '🐢', 36049, c => turtle(c.d)],
  ['SECRET_AGENT', 'Secret Agent', '🕶️', 34614, c => c.has('007')],
  ['HEAVY', 'Heavy', '🧱', 33300, c => c.sum > 45],
  ['CONTIGUOUS_BOAT', 'Contiguous Full House', '🏰', 30111, c => {
    const m = c.s.match(/(\d)\1\1(\d)\2/); if (m && m[1] !== m[2]) return true;
    const m2 = c.s.match(/(\d)\1(\d)\2\2/); return !!(m2 && m2[1] !== m2[2]);
  }],
  ['JACKPOT', 'Jackpot', '💰', 27027, c => c.has('777')],
  ['DEVIL', 'Devil', '😈', 27027, c => c.has('666')],
  ['SEQUENCE_4', 'Sequence (4)', '🔢', 25907, c => pHasSequence(c.s, 4, false)],
  ['ERROR', 'Error 404', '🚫', 25132, c => c.has('404')],
  ['ORIENTATION', 'Orientation', '🧭', 25132, c => c.has('101')],
  ['BOTANIST', 'Botanist', '🌿', 25006, c => c.has('420')],
  ['EMERGENCY', 'Emergency', '🚑', 25006, c => c.has('911')],
  ['PI_CONTAINS_3', 'Pi Slice (3)', '🥧', 25006, c => c.has('314')],
  ['E_CONTAINS_3', 'E Slice (3)', '📈', 25006, c => c.has('271')],
  ['TREE_FIDDY', 'Tree Fiddy', '🦕', 25006, c => c.has('350')],
  ['CALENDAR', 'Calendar', '📅', 25006, c => c.has('365')],
  ['DIVISIBLE_BY_THREE', 'Divisible by Three', '🔺', 24414, c => c.d.every(x => x % 3 === 0)],
  ['SCRAMBLE', 'Scramble', '🔀', 22722, c => c.len >= 2 && c.distinct === c.len && (Math.max(...c.d) - Math.min(...c.d)) === c.len - 1],
  ['DUALITY', 'Duality', '☯️', 21654, c => c.distinct === 2],
  ['STEPS', 'Steps', '🪜', 20202, c => { if (c.len < 2) return false; let rose = false; for (let i = 1; i < c.len; i++) { if (c.d[i] < c.d[i - 1]) return false; if (c.d[i] > c.d[i - 1]) rose = true; } return rose; }],
  ['ARITHMETIC', 'Metronome', '🎼', 17784, c => findArithmeticSplit(c.s) !== null],
  ['FRAMED_DOUBLE', 'Framed Double', '🖼️🖼️🖼️', 15242, c => c.len === 6 && c.d[1] === c.d[2] && c.d[3] === c.d[4] && c.d[1] !== c.d[3] && c.d[0] !== c.d[1] && c.d[5] !== c.d[4]],
  ['SLOPES', 'Slopes', '🛝', 12582, c => { if (c.len < 2) return false; let fell = false; for (let i = 1; i < c.len; i++) { if (c.d[i] > c.d[i - 1]) return false; if (c.d[i] < c.d[i - 1]) fell = true; } return fell; }],
  ['PAIRED_BOOKENDS', 'Paired Bookends', '👐', 11122, c => c.len >= 4 && c.d[0] === c.d[1] && c.d[c.len - 1] === c.d[c.len - 2] && c.d[0] !== c.d[c.len - 1]],
  ['FOUR_DIGITS', 'Four Digits', '🍀', 11111, c => c.len === 4],
  ['THREE_PAIR', 'Three Pair', '👯‍♀️👯', 10288, c => c.countExact(2) >= 3],
  ['BOOKENDS', 'Bookends', '📚', 10010, c => c.len >= 4 && c.s.slice(0, 2) === c.s.slice(-2)],
  ['MIRROR_BOOKENDS', 'Mirror Bookends', '📖', 10010, c => c.len >= 4 && c.d[0] === c.d[c.len - 1] && c.d[1] === c.d[c.len - 2]],
  ['CENTURY', 'Century', '💯', 10000, c => c.s.endsWith('00')],
  ['DOUBLE_NINE', 'Double Nine', '🎈', 10000, c => c.s.endsWith('99')],
  ['SEMI_CENTURY', 'Semi-Century', '🗓️', 10000, c => c.s.endsWith('50')],

  // --- Uncommon ---
  ['QUADS', 'Four of a Kind', '🍀', 8436, c => c.maxCount >= 4],
  ['EQUATION', 'Equation', '🟰', 7720, c => findEquation(c.s) !== null],
  ['LOW_BALL', 'Low Ball', '📉', 6400, c => /^[0-4]+$/.test(c.s)],
  ['CONTIGUOUS_TWO_PAIR', 'Contiguous Two Pair', '👨‍👩‍👧‍👦', 6142, c => { const a = pContigPairStarts(c.s); for (let i = 0; i < a.length - 1; i++) if (a[i] + 2 === a[i + 1]) return true; return false; }],
  ['MOUNTAIN', 'Mountain', '🏔️', 5885, c => mountain(c.d)],
  ['DOUBLE_HOP', 'Double Hop', '🦘🦘', 5321, c => { if (c.len < 5 || c.distinct < 2) return false; for (let e = 0; e <= c.len - 5; e++) if (c.s[e + 2] === c.s[e] && c.s[e + 4] === c.s[e]) return true; return false; }],
  ['HIGH_ROLLER', 'High Roller', '🤑', 5120, c => /^[5-9]+$/.test(c.s)],
  ['VALLEY', 'Valley', '🏜️', 4199, c => valley(c.d)],
  ['MINI_ECHO', 'Mini Echo', '🔂', 3704, c => /(\d\d)\1/.test(c.s)],
  ['ALTERNATOR', 'Alternator', '⚡', 2845, c => alternator(c.d)],
  ['FLUSH', 'Flush', '🎨', 2845, c => allSameParity(c.d)],
  ['CONTIGUOUS_TRIPS', 'Contiguous Trips', '➖', 2784, c => /(\d)\1\1/.test(c.s)],
  ['DEEP_VOID', 'Deep Void', '🕳️', 2784, c => c.has('00')],
  ['FEATHER', 'Feather', '🪶', 2667, c => c.sum < 15],
  ['BLACKJACK', 'Blackjack', '♠️', 2521, c => c.sum === 21],
  ['BOAT', 'Full House', '🏠', 2397, c => { const v = Object.values(c.counts).sort((a, b) => b - a); return v[0] >= 3 && (v[1] || 0) >= 2; }],
  ['POCKET_MIRROR', 'Pocket Mirror', '🪞', 2124, c => { for (let L = 4; L <= c.len; L++) for (let i = 0; i + L <= c.len; i++) if (isPalindromeStr(c.s.slice(i, i + L))) return true; return false; }],
  ['SNAKE_EYES', 'Snake Eyes', '🎲', 2121, c => { if ((c.counts[1] || 0) !== 2) return false; for (const k in c.counts) if (k !== '1' && c.counts[k] >= 2) return false; return true; }],
  ['NICE', 'Nice', '😏', 2024, c => c.has('69')],
  ['MEANING', 'Meaning of Life', '🌌', 2024, c => c.has('42')],
  ['SIXTY_SEVEN', 'Six-Seven', '🫠', 2024, c => c.has('67')],
  ['EIGHTY_SIX', 'Eighty-Six', '🍽️', 2024, c => c.has('86')],
  ['BALANCED', 'Balanced', '⚖️', 1959, c => {
    if (c.len < 2 || c.len % 2 !== 0) return false; // prod: even length only
    const h = c.len / 2;
    let a = 0, b = 0;
    for (let i = 0; i < h; i++) { a += c.d[i]; b += c.d[h + i]; }
    return a === b;
  }],
  ['RHYME', 'Rhyme', '🎶', 1872, c => {
    // Same 2+ digit substring appears twice WITHOUT overlapping (so "00" inside "000"
    // does not count - that's why 455000 gets no Rhyme).
    for (let L = 2; L <= c.len - 1; L++)
      for (let i = 0; i + L <= c.len; i++)
        if (c.s.indexOf(c.s.slice(i, i + L), i + L) !== -1) return true;
    return false;
  }],
  ['SEQUENCE_3', 'Sequence (3)', '🔢', 1716, c => pHasSequence(c.s, 3, false)],
  ['CONSEC_PAIR_ADJACENT', '2 Consecutive Numbers (Contains)', '🔗', 1659, c => pPairAdjacent(c.s) !== null],
  ['CONSEC_PAIR_NEARBY', '2 Consecutive Numbers (Nearby)', '🔗', 1575, c => pPairNearby(c.s) !== null],
  ['MESA', 'Mesa', '🗻', 1568, c => { let rose = false, fell = false; for (let i = 1; i < c.len; i++) { const a = c.d[i], b = c.d[i - 1]; if (a > b) { if (fell) return false; rose = true; } else if (a < b) fell = true; } return rose && fell; }],
  ['PRIME', 'Prime Number', '💎', 1274, c => isPrime(c.n)],
  ['TRINITY', 'Trinity', '⚜️', 1265, c => c.distinct === 3],
  ['DOZEN', 'Dozen', '🍩', 1200, c => c.n > 0 && c.n % 12 === 0],
  ['CANYON', 'Canyon', '🪨', 1184, c => { let rose = false, fell = false; for (let i = 1; i < c.len; i++) { const a = c.d[i], b = c.d[i - 1]; if (a < b) { if (rose) return false; fell = true; } else if (a > b) rose = true; } return rose && fell; }],
  ['FIVE_DIGITS', 'Five Digits', '🖐️', 1111, c => c.len === 5],
  ['ELEVEN', 'Eleven', '🕚', 1100, c => c.n > 0 && c.n % 11 === 0],
  ['HARSHAD', 'Harshad Number', '🤝', 1048, c => c.sum > 0 && c.n % c.sum === 0],
  ['CLEAN', 'Clean', '🧼', 1000, c => c.s.endsWith('0')],
  ['SEMI_CLEAN', 'Semi-Clean', '🧹', 1000, c => c.s.endsWith('5')],
  ['EQUILIBRIUM', 'Equilibrium', '🧘', 1000, c => c.len >= 2 && c.d[0] === c.d[c.len - 1]],
  ['SANDWICH', 'Sandwich', '🥪', 1000, c => c.len >= 3 && c.d[0] === c.d[c.len - 1] && c.d.slice(1, -1).some(x => x !== c.d[0])],

  // --- Common ---
  ['HILLS', 'Hills', '🏞️', 733, c => c.len >= 4 && hills(c.d)], // prod requires length >= 4
  ['TRIPS', 'Three of a Kind', '🎰', 724, c => c.countExact(3) > 0], // exactly 3 (a quad is not trips)
  ['LUCKY_SEVEN_DIV', 'Lucky Seven (Divisible)', '🎰', 700, c => c.n > 0 && c.n % 7 === 0],
  ['HETEROGENEOUS', 'Heterogeneous', '🥗', 593, c => c.distinct === c.len],
  ['MINI_SCRAMBLE', 'Mini Scramble', '🧩', 579, c => { for (let L = 3; L <= c.len; L++) for (let i = 0; i + L <= c.len; i++) if (isScrambledSeq(c.s.slice(i, i + L), 3)) return true; return false; }],
  ['GAP_ONE', 'Gap One', '↕️', 529, c => c.len >= 2 && Math.abs(c.d[0] - c.d[c.len - 1]) === 1],
  ['TWO_PAIR', 'Two Pair', '👯‍♀️', 447, c => c.countExact(2) >= 2],
  ['DUNES', 'Dunes', '🐫', 364, c => { let coll = c.s[0] ?? ''; for (let i = 1; i < c.len; i++) if (c.s[i] !== c.s[i - 1]) coll += c.s[i]; if (coll.length < 4) return false; for (let i = 2; i < coll.length; i++) { const p = +coll[i - 2], q = +coll[i - 1], r = +coll[i], a = q - p, b = r - q; if (a > 0 && b > 0 || a < 0 && b < 0) return false; } return true; }],
  ['HOPSCOTCH', 'Hopscotch', '🦘', 312, c => {
    if (c.len < 3 || c.distinct < 2) return false;
    for (let e = 0; e <= c.len - 3; e++) {
      if (c.s[e + 2] === c.s[e]) {
        const ahead = c.len > e + 4 && c.s[e + 4] === c.s[e];
        const behind = e >= 2 && c.s[e - 2] === c.s[e];
        if (!ahead && !behind) return true; // exactly a 2-long every-other run
      }
    }
    return false;
  }],
  ['GHOST', 'Ghost', '👻', 309, c => (c.counts[0] || 0) === 1],
  ['QUARTET', 'Quartet', '🎻', 290, c => c.distinct === 4],
  ['HYDROGEN', 'Hydrogen (1)', '💧', 282, c => (c.counts[1] || 0) === 1],
  ['HELIUM', 'Helium (2)', '🎈', 282, c => (c.counts[2] || 0) === 1],
  ['CARBON', 'Carbon (6)', '✏️', 282, c => (c.counts[6] || 0) === 1],
  ['OXYGEN', 'Oxygen (8)', '💨', 282, c => (c.counts[8] || 0) === 1],
  ['LITHIUM', 'Lithium (3)', '🔋', 282, c => (c.counts[3] || 0) === 1],
  ['BERYLLIUM', 'Beryllium (4)', '💎', 282, c => (c.counts[4] || 0) === 1],
  ['BORON', 'Boron (5)', '🧼', 282, c => (c.counts[5] || 0) === 1],
  ['NITROGEN', 'Nitrogen (7)', '❄️', 282, c => (c.counts[7] || 0) === 1],
  ['FLUORINE', 'Fluorine (9)', '🦷', 282, c => (c.counts[9] || 0) === 1],
  ['GROUNDED', 'Grounded', '⚓', 250, c => c.len >= 2 && c.d[0] < c.d[c.len - 1]],
  ['CONTIGUOUS_PAIR', 'Contiguous Pair', '🫂', 249, c => /(\d)\1/.test(c.s)],
  ['LUCKY_7', 'Lucky Seven', '7️⃣', 213, c => c.has('7')],
  ['EVEN', 'Even', '⚖️', 200, c => c.n % 2 === 0],
  ['ODD', 'Odd', '🦄', 200, c => c.n % 2 === 1],
  ['LIFTOFF', 'Liftoff', '🚀', 200, c => c.len >= 2 && c.d[0] > c.d[c.len - 1]],
  ['VOID', 'Void', '🕳️', 167, c => !c.has('0')],
  ['NEIGHBORS', 'Neighbors', '🏘️', 161, c => {
    for (let i = 0; i + 1 < c.len; i++) if (Math.abs(c.d[i] - c.d[i + 1]) === 1) return true; // adjacent positions only
    return false;
  }],
  // CSV lists Pair at 120, but the live game scores it 0 (see the "Pair Fix" toggle /
  // the pairFix option in compute()). Inferred from prod: 634700 = 18,194.
  ['PAIR', 'Pair', '👯', 120, c => c.maxCount >= 2],
  ['SIX_DIGITS', 'Six Digits', '🐝', 111, c => c.len === 6],
];

// ---------------------------------------------------------------------------
// Human-readable requirement per badge (from the source CSV "Description").
// Shown in the hover tooltip alongside the probability below.
// ---------------------------------------------------------------------------

const DESCRIPTIONS = {
  NICE_EXACT: 'Exactly "69".',
  JACKPOT_EXACT: 'Exactly "777".',
  JACKPOT_SIX: 'Contains six 7s in a row.',
  BOTANIST_EXACT: 'Exactly "420".',
  DEVIL_EXACT: 'Exactly "666".',
  LEET_EXACT: 'Exactly "1337".',
  EXACT_HELL: 'Exactly "7734".',
  EXACT_BOOB_80085: 'Exactly "80085".',
  MEANING_EXACT: 'Exactly "42".',
  EMERGENCY_EXACT: 'Exactly "911".',
  VERY_VERY_NICE: 'Exactly "696969".',
  HOTBOX: 'Exactly "420420".',
  MAYDAY: 'Exactly "911911".',
  UNIVERSAL_ANSWER: 'Exactly "424242".',
  BIG_BROTHER_EXACT: 'Exactly "1984".',
  DIGIT_ZERO: 'The number zero.',
  DIGIT_ONE: 'The number one.',
  DIGIT_TWO: 'The number two.',
  DIGIT_THREE: 'The number three.',
  DIGIT_FOUR: 'The number four.',
  DIGIT_FIVE: 'The number five.',
  DIGIT_SIX: 'The number six.',
  DIGIT_SEVEN: 'The number seven.',
  DIGIT_EIGHT: 'The number eight.',
  DIGIT_NINE: 'The number nine.',
  TREE_FIDDY_EXACT: 'Exactly "350".',
  SIXTY_SEVEN_EXACT: 'Exactly "67".',
  EIGHTY_SIX_EXACT: 'Exactly "86".',
  ORIENTATION_EXACT: 'Exactly "101".',
  CALENDAR_EXACT: 'Exactly "365".',
  BRAINROT: 'Exactly "676767".',
  GROUNDHOG_DAY: 'Exactly "365365".',
  ONE_MILLION: 'The number one million.',
  EXACT_BOOB: 'Exactly "8008" or "58008".',
  THIRTEENTH_POWER: 'A perfect thirteenth power (n¹³).',
  SEVENTEENTH_POWER: 'A perfect seventeenth power (n¹⁷).',
  NINETEENTH_POWER: 'A perfect nineteenth power (n¹⁹).',
  TENTH_POWER: 'A perfect tenth power (n¹⁰).',
  ELEVENTH_POWER: 'A perfect eleventh power (n¹¹).',
  PI: 'Exactly π (314, 3141, 31415, or 314159).',
  E: 'The number e (271, 2718, 27182, or 271828).',
  CONSEC_QUAD_EXACT: 'The entire number splits into four consecutive integers in order.',
  NINTH_POWER: 'A perfect ninth power (n⁹).',
  EIGHTH_POWER: 'A perfect eighth power (n⁸).',
  SEVENTH_POWER: 'A perfect seventh power (n⁷).',
  FACTORIAL: 'A factorial number (n!).',
  HELLO: 'Contains "07734" (spells HELLO upside-down).',
  SEQUENCE_6: 'Contains a sequence of 6 consecutive digits.',
  CONTIGUOUS_SIXES: 'Six identical consecutive digits.',
  DEEP_VOID_FIVE: 'Contains "00000".',
  ONE_DIGIT: 'Has exactly one digit.',
  QUINT_NINE: 'Ends in 99999.',
  SIXTH_POWER: 'A perfect sixth power (n⁶).',
  POWER_OF_THREE: 'A power of 3 (3ⁿ).',
  FIFTH_POWER: 'A perfect fifth power (n⁵).',
  JACKPOT_FIVE: 'Contains five 7s in a row.',
  POWER_OF_TWO: 'A power of 2 (2ⁿ).',
  ROYAL_FLUSH: 'Contains 56789 - the highest possible straight.',
  BOOB_58008: 'Contains "58008" (spells BOOBS upside-down).',
  BOOB_80085: 'Contains "80085" (spells BOOBS).',
  PI_CONTAINS_5: 'Contains "31415".',
  E_CONTAINS_5: 'Contains "27182".',
  CASCADE: 'Every digit increases by exactly 1 from the previous.',
  FIBONACCI: 'Part of the golden ratio sequence found in nature.',
  FOURTH_POWER: 'A perfect fourth power (n⁴).',
  WATERFALL: 'Every digit decreases by exactly 1 from the previous.',
  CONSEC_QUAD_CONTAINS: 'Contains four adjacent consecutive integers.',
  CONSEC_QUAD_SCRAMBLED: 'The entire number splits into four consecutive integers, but not in order.',
  HOMOGENEOUS: 'All digits are the same.',
  BINARY_SOUL: 'Only 0s and 1s.',
  STRAIGHT_FLUSH: 'Contains 5 consecutive same-parity digits (02468, 13579, or their reverse).',
  TWO_DIGITS: 'Has exactly two digits.',
  SPY: 'The sum of its digits equals the product of its digits.',
  QUAD_NINE: 'Ends in 9999.',
  SEMI_EPOCH: 'Ends in "5000".',
  CUBE: 'A perfect cube (n³).',
  EVEN_SPACING: 'All digits are evenly spaced in an arithmetic sequence.',
  CONSEC_TRIPLE_EXACT: 'The entire number splits into three consecutive integers in order.',
  CONTIGUOUS_FIVES: 'Five identical consecutive digits.',
  DEEP_VOID_FOUR: 'Contains "0000".',
  STROBOGRAMMATIC: 'Looks the same when rotated 180 degrees.',
  STRAIGHT: 'Contains a sequence of 5 consecutive digits (ascending or descending).',
  JACKPOT_FOUR: 'Contains four 7s in a row.',
  VERY_NICE: 'Contains "6969".',
  DEEPER_MEANING: 'Contains "4242".',
  SIXTY_SEVEN_DOUBLE: 'Contains "6767".',
  LEET: 'Contains "1337".',
  HELL: 'Contains "7734" (spells HELL upside-down).',
  BOOB_8008: 'Contains "8008" (spells BOOB upside-down).',
  BIG_BROTHER: 'Contains "1984".',
  PI_CONTAINS_4: 'Contains "3141".',
  E_CONTAINS_4: 'Contains "2718".',
  CONSEC_TRIPLE_SCRAMBLED: 'The entire number splits into three consecutive integers, but not in order.',
  ZIPPER: 'Two digits alternating perfectly.',
  ASCENSION: 'Every digit is strictly larger than the previous.',
  CONSEC_TRIPLE_CONTAINS: 'Contains three adjacent consecutive integers.',
  CONTIGUOUS_THREE_PAIR: 'Contains three adjacent contiguous pairs.',
  FRAMED_PAIR: 'A 4-digit number where the middle two digits match each other but differ from both end digits.',
  FRAMED_TRIPLE: 'A triple in the middle, bookended by different digits.',
  DECAY: 'Every digit is strictly smaller than the previous.',
  THREE_DIGITS: 'Has exactly three digits.',
  ECHO: 'The first half repeats as the second half.',
  MILLENNIUM: 'Ends in triple zeros.',
  PRONIC: 'The product of two consecutive integers (n * n+1).',
  TRIPLE_NINE: 'Ends in 999.',
  SEMI_MILLENNIUM: 'Ends in "500".',
  COLOSSAL: 'A number greater than 999,000.',
  SQUARE: 'A perfect square (n²).',
  EVEN_SPACING_ABS: 'All digits have the same absolute spacing (e.g., ±2 each time).',
  FIREFLY: 'One unique digit among identical others.',
  CONSEC_PAIR_EXACT: 'The entire number splits into two consecutive integers.',
  PALINDROME: 'Reads the same forwards and backwards.',
  CONTIGUOUS_QUADS: 'Four identical consecutive digits.',
  DEEP_VOID_THREE: 'Contains "000".',
  TURTLE: 'All consecutive digits differ by at most 1.',
  SECRET_AGENT: 'Contains "007".',
  HEAVY: 'The sum of its digits exceeds 45.',
  CONTIGUOUS_BOAT: 'Contains a contiguous set of three adjacent to a contiguous set of two.',
  JACKPOT: 'Contains "777".',
  DEVIL: 'Contains "666".',
  SEQUENCE_4: 'Contains a sequence of 4 consecutive digits.',
  ERROR: 'Contains "404".',
  ORIENTATION: 'Contains "101" (intro course number).',
  BOTANIST: 'Contains "420".',
  EMERGENCY: 'Contains "911".',
  PI_CONTAINS_3: 'Contains "314".',
  E_CONTAINS_3: 'Contains "271".',
  TREE_FIDDY: 'Contains "350" (the Loch Ness Monster\'s request).',
  CALENDAR: 'Contains "365" (days in a year).',
  DIVISIBLE_BY_THREE: 'Every digit is divisible by 3.',
  SCRAMBLE: 'All digits form a consecutive sequence when sorted.',
  DUALITY: 'Uses exactly two different digits.',
  FRAMED_DOUBLE: 'Two pairs in the middle, bookended by different digits.',
  PAIRED_BOOKENDS: 'Starts with a pair and ends with a different pair.',
  FOUR_DIGITS: 'Has exactly four digits.',
  THREE_PAIR: 'Contains three distinct pairs of matching digits.',
  BOOKENDS: 'The first two digits match the last two.',
  MIRROR_BOOKENDS: 'First two digits are reversed as the last two.',
  CENTURY: 'Ends in double zeros.',
  DOUBLE_NINE: 'Ends in 99.',
  SEMI_CENTURY: 'Ends in "50".',
  QUADS: 'Contains four identical digits.',
  LOW_BALL: 'Contains only digits from 0 to 4.',
  CONTIGUOUS_TWO_PAIR: 'Contains two adjacent contiguous pairs.',
  MOUNTAIN: 'Digits ascend to a peak and then descend.',
  DOUBLE_HOP: 'A digit appears at every other position (3 times).',
  HIGH_ROLLER: 'Contains only digits from 5 to 9.',
  VALLEY: 'Digits descend to a trough and then ascend.',
  MINI_ECHO: 'Contains an adjacent 2-digit repeat.',
  ALTERNATOR: 'Digits strictly alternate between even and odd.',
  FLUSH: 'All digits are either all even or all odd.',
  CONTIGUOUS_TRIPS: 'Three identical consecutive digits.',
  DEEP_VOID: 'Contains "00".',
  FEATHER: 'The sum of its digits is less than 15.',
  BLACKJACK: 'Digits sum exactly to 21.',
  BOAT: 'Contains a set of three and a set of two.',
  SNAKE_EYES: 'Contains a single pair of ones and no other pairs.',
  NICE: 'Contains the number 69.',
  MEANING: 'Contains "42".',
  SIXTY_SEVEN: 'Contains "67".',
  EIGHTY_SIX: 'Contains "86" (restaurant slang for "out of").',
  BALANCED: 'Sum of first half of digits equals sum of second half.',
  RHYME: 'Contains the same 2+ digit substring twice.',
  SEQUENCE_3: 'Contains a sequence of 3 consecutive digits.',
  CONSEC_PAIR_ADJACENT: 'Contains two adjacent substrings that are consecutive integers.',
  CONSEC_PAIR_NEARBY: 'Contains two non-adjacent substrings that are consecutive integers.',
  PRIME: 'Divisible only by 1 and itself.',
  TRINITY: 'Uses exactly three different digits.',
  DOZEN: 'Divisible by 12.',
  FIVE_DIGITS: 'Has exactly five digits.',
  ELEVEN: 'Divisible by 11.',
  HARSHAD: 'Divisible by the sum of its own digits.',
  CLEAN: 'Ends in a zero.',
  SEMI_CLEAN: 'Ends in a 5.',
  EQUILIBRIUM: 'The first and last digits are identical.',
  SANDWICH: 'First and last digits match, with at least one different digit between them.',
  HILLS: 'Digits strictly alternate between rising and falling.',
  TRIPS: 'Contains three identical digits.',
  LUCKY_SEVEN_DIV: 'Divisible by 7.',
  HETEROGENEOUS: 'No repeated digits.',
  GAP_ONE: 'The first and last digits differ by exactly 1.',
  TWO_PAIR: 'Contains two distinct pairs of matching digits.',
  HOPSCOTCH: 'A digit appears at every other position (2 times).',
  GHOST: 'Contains exactly one "0".',
  QUARTET: 'Uses exactly four different digits.',
  HYDROGEN: 'Contains exactly one "1".',
  HELIUM: 'Contains exactly one "2".',
  CARBON: 'Contains exactly one "6".',
  OXYGEN: 'Contains exactly one "8".',
  LITHIUM: 'Contains exactly one "3".',
  BERYLLIUM: 'Contains exactly one "4".',
  BORON: 'Contains exactly one "5".',
  NITROGEN: 'Contains exactly one "7".',
  FLUORINE: 'Contains exactly one "9".',
  GROUNDED: 'The first digit is smaller than the last.',
  CONTIGUOUS_PAIR: 'Contains a contiguous pair of matching digits.',
  LUCKY_7: 'Contains the number 7.',
  EVEN: 'Divisible by 2.',
  ODD: 'Not divisible by 2.',
  LIFTOFF: 'The first digit is larger than the last.',
  VOID: 'Contains no zeros.',
  NEIGHBORS: 'Contains two digits that are adjacent in value.',
  PAIR: 'Contains a pair of matching digits.',
  SIX_DIGITS: 'Has exactly six digits.',
  // --- 2026-07-16 batch ---
  STEPS: 'Digits never decrease.',
  SLOPES: 'Digits never increase.',
  MESA: 'Digits rise to a peak, then fall (flat stretches allowed).',
  CANYON: 'Digits fall to a floor, then rise (flat stretches allowed).',
  DUNES: 'Rises and falls keep alternating (flat stretches allowed).',
  POCKET_MIRROR: 'Contains a palindrome of 4 or more digits.',
  ARITHMETIC: 'Splits into three or more numbers with a constant difference.',
  GEOMETRIC: 'Splits into three or more numbers with a constant ratio.',
  EQUATION: 'Insert one of + − × ÷ and an equals sign to make a true equation.',
  FIVE_OF_A_KIND: 'Contains five identical digits.',
  FRAMED_QUAD: 'Four of a kind in the middle, bookended by different digits.',
  OUROBOROS: 'A number raised to itself: nⁿ (1¹, 2², … 7⁷).',
  POWER_OF_FIVE: 'A power of 5 (5ⁿ).',
  POWER_OF_SEVEN: 'A power of 7 (7ⁿ).',
  TAU: 'Exactly τ (6283, 62831, or 628318).',
  TAU_SLICE_4: 'Contains "6283".',
  TAU_SLICE_5: 'Contains "62831".',
  GOLDEN_RATIO: 'Exactly φ (1618, 16180, or 161803).',
  ALWAYS: 'Exactly "247365" or "365247" (24/7, 365).',
  FULL_DAY: 'Exactly "86400", the number of seconds in a day.',
  FOOTBALL_17776: 'Exactly "17776".',
  ERROR_EXACT: 'Exactly "404".',
  INFERNAL: 'Exactly "666666".',
  ULTIMEME: 'Contains both "69" and "420".',
  ULTIMEME_EXACT: 'Exactly "69420" or "42069".',
  MINI_SCRAMBLE: 'Contains 3 or more adjacent digits that form a run when sorted.',
};

// PROBABILITIES (exact share of all 1,000,001 inputs 0..1,000,000 that earn each
// badge, as a percent) is generated by research/gen-snapshot.mjs (`npm run gen`)
// from a full-range scan - it self-corrects whenever a badge test changes.
// (The previous hand-embedded copy had drifted badly from the prod-parity rules.)

// Format a percentage for display, keeping small values legible.
function fmtProb(p) {
  if (p === undefined) return '-';
  if (p === 0) return '0%';
  if (p >= 1) return `${Number(p.toFixed(2))}%`;
  if (p >= 0.01) return `${Number(p.toFixed(3))}%`;
  return `${Number(p.toFixed(4))}%`;
}

// ---------------------------------------------------------------------------
// Compute
// ---------------------------------------------------------------------------

// Supersession families: prod tags each badge with a `family` and, within a family, only
// the single HIGHEST-EP earned badge scores - the rest are still displayed as earned but
// score 0, because the higher tier already implies them. This list is the full family map
// extracted from the live game's BADGE_DEFINITIONS (40 families / 161 badges); the remaining
// 69 badges are standalone and always score. Member order is irrelevant - the scorer keeps
// the max-EP member - but each family is listed highest-EP first for readability.
export const FAMILIES = [
  ['THIRTEENTH_POWER', 'SEVENTEENTH_POWER', 'NINETEENTH_POWER', 'TENTH_POWER', 'ELEVENTH_POWER', 'NINTH_POWER', 'EIGHTH_POWER', 'SEVENTH_POWER', 'SIXTH_POWER', 'FIFTH_POWER', 'FOURTH_POWER', 'CUBE', 'SQUARE', 'OUROBOROS'], // POWER
  ['DIGIT_ZERO', 'DIGIT_ONE', 'DIGIT_TWO', 'DIGIT_THREE', 'DIGIT_FOUR', 'DIGIT_FIVE', 'DIGIT_SIX', 'DIGIT_SEVEN', 'DIGIT_EIGHT', 'DIGIT_NINE', 'ONE_DIGIT'], // SINGLE_DIGIT
  ['CONSEC_QUAD_EXACT', 'CONSEC_QUAD_CONTAINS', 'CONSEC_QUAD_SCRAMBLED', 'CONSEC_TRIPLE_EXACT', 'CONSEC_TRIPLE_SCRAMBLED', 'CONSEC_TRIPLE_CONTAINS', 'CONSEC_PAIR_EXACT', 'CONSEC_PAIR_ADJACENT', 'CONSEC_PAIR_NEARBY'], // CONSECUTIVE
  ['SEQUENCE_6', 'CASCADE', 'WATERFALL', 'EVEN_SPACING', 'EVEN_SPACING_ABS', 'TURTLE', 'SEQUENCE_4', 'SCRAMBLE', 'SEQUENCE_3', 'GEOMETRIC', 'ARITHMETIC', 'MINI_SCRAMBLE'], // PROGRESSION
  ['CONTIGUOUS_THREE_PAIR', 'FRAMED_PAIR', 'FRAMED_DOUBLE', 'THREE_PAIR', 'CONTIGUOUS_TWO_PAIR', 'TWO_PAIR', 'CONTIGUOUS_PAIR', 'PAIR'], // PAIRS
  ['EXACT_BOOB_80085', 'EXACT_BOOB', 'BOOB_58008', 'BOOB_80085', 'BOOB_8008'], // BOOB
  ['BOTANIST_EXACT', 'MEANING_EXACT', 'HOTBOX', 'BOTANIST', 'MEANING'], // BOTANIST
  ['JACKPOT_EXACT', 'JACKPOT_SIX', 'JACKPOT_FIVE', 'JACKPOT_FOUR', 'JACKPOT'], // JACKPOT
  ['CONTIGUOUS_SIXES', 'CONTIGUOUS_FIVES', 'CONTIGUOUS_QUADS', 'CONTIGUOUS_TRIPS'], // CONTIGUOUS_RUN
  ['E', 'E_CONTAINS_5', 'E_CONTAINS_4', 'E_CONTAINS_3'], // E
  ['NICE_EXACT', 'VERY_VERY_NICE', 'VERY_NICE', 'NICE'], // NICE
  ['QUINT_NINE', 'QUAD_NINE', 'TRIPLE_NINE', 'DOUBLE_NINE'], // NINE_ENDING
  ['PI', 'PI_CONTAINS_5', 'PI_CONTAINS_4', 'PI_CONTAINS_3'], // PI
  ['SIXTY_SEVEN_EXACT', 'BRAINROT', 'SIXTY_SEVEN_DOUBLE', 'SIXTY_SEVEN'], // SIXTY_SEVEN
  ['DEEP_VOID_FIVE', 'DEEP_VOID_FOUR', 'DEEP_VOID_THREE', 'DEEP_VOID'], // VOID_DEPTH
  ['PAIRED_BOOKENDS', 'BOOKENDS', 'MIRROR_BOOKENDS'], // BOOKENDS
  ['CALENDAR_EXACT', 'GROUNDHOG_DAY', 'CALENDAR', 'ALWAYS'], // CALENDAR
  ['EMERGENCY_EXACT', 'MAYDAY', 'EMERGENCY'], // EMERGENCY
  ['FRAMED_TRIPLE', 'FRAMED_QUAD', 'QUADS', 'FIVE_OF_A_KIND', 'TRIPS'], // OF_A_KIND
  ['ROYAL_FLUSH', 'STRAIGHT_FLUSH', 'STRAIGHT'], // STRAIGHT
  ['BIG_BROTHER_EXACT', 'BIG_BROTHER'], // BIG_BROTHER
  ['CONTIGUOUS_BOAT', 'BOAT'], // BOAT
  ['DEVIL_EXACT', 'INFERNAL', 'DEVIL'], // DEVIL
  ['FIREFLY', 'DUALITY'], // DUALITY
  ['EIGHTY_SIX_EXACT', 'EIGHTY_SIX'], // EIGHTY_SIX
  ['EQUILIBRIUM', 'SANDWICH'], // EQUILIBRIUM
  ['EXACT_HELL', 'HELL'], // HELL
  ['DOUBLE_HOP', 'HOPSCOTCH'], // HOPSCOTCH
  ['LEET_EXACT', 'LEET'], // LEET
  ['UNIVERSAL_ANSWER', 'DEEPER_MEANING'], // MEANING
  ['ASCENSION', 'DECAY', 'STEPS', 'SLOPES'], // MONOTONIC
  ['ORIENTATION_EXACT', 'ORIENTATION'], // ORIENTATION
  ['MOUNTAIN', 'VALLEY', 'MESA', 'CANYON'], // PEAK
  ['MINI_ECHO', 'RHYME'], // REPEAT
  ['TREE_FIDDY_EXACT', 'TREE_FIDDY'], // TREE_FIDDY
  ['ERROR_EXACT', 'ERROR'], // ERROR (2026-07-16)
  ['HILLS', 'DUNES'], // HILLS (2026-07-16)
  ['PALINDROME', 'POCKET_MIRROR'], // PALINDROME (2026-07-16)
  ['TAU', 'TAU_SLICE_5', 'TAU_SLICE_4'], // TAU (2026-07-16)
  ['ULTIMEME_EXACT', 'ULTIMEME'], // ULTIMEME (2026-07-16)
];

// Display names for FAMILIES, index-aligned with the array above (same order as
// prod's family tags). Only used by the /badges index page.
const FAMILY_NAMES = [
  'Power', 'Single Digit', 'Consecutive', 'Progression', 'Pairs', 'Boob', 'Botanist',
  'Jackpot', 'Contiguous Run', 'E', 'Nice', 'Nine Ending', 'Pi', 'Sixty-Seven',
  'Void Depth', 'Bookends', 'Calendar', 'Emergency', 'Of a Kind', 'Straight',
  'Big Brother', 'Boat', 'Devil', 'Duality', 'Eighty-Six', 'Equilibrium', 'Hell',
  'Hopscotch', 'Leet', 'Meaning', 'Monotonic', 'Orientation', 'Peak', 'Repeat',
  'Tree Fiddy', 'Error', 'Hills', 'Palindrome', 'Tau', 'Ultimeme',
];

// Badges added to this tool after the initial full-parity port, keyed to the date we
// added them here. Powers the "Newly added" section + per-card markers on /badges.
// When a fresh batch lands (see CLAUDE.md), append entries with the new date and bump
// LATEST_BADGE_BATCH so only the most recent batch gets the highlight.
const BADGE_ADDED = {
  STEPS: '2026-07-16', SLOPES: '2026-07-16', MESA: '2026-07-16', CANYON: '2026-07-16',
  DUNES: '2026-07-16', POCKET_MIRROR: '2026-07-16', ARITHMETIC: '2026-07-16',
  GEOMETRIC: '2026-07-16', EQUATION: '2026-07-16', FIVE_OF_A_KIND: '2026-07-16',
  FRAMED_QUAD: '2026-07-16', OUROBOROS: '2026-07-16', POWER_OF_FIVE: '2026-07-16',
  POWER_OF_SEVEN: '2026-07-16', TAU: '2026-07-16', TAU_SLICE_4: '2026-07-16',
  TAU_SLICE_5: '2026-07-16', GOLDEN_RATIO: '2026-07-16', ALWAYS: '2026-07-16',
  FULL_DAY: '2026-07-16', FOOTBALL_17776: '2026-07-16', ERROR_EXACT: '2026-07-16',
  INFERNAL: '2026-07-16', ULTIMEME: '2026-07-16', ULTIMEME_EXACT: '2026-07-16',
  MINI_SCRAMBLE: '2026-07-16',
};
// Badges added on this date get the "Newly added" treatment on /badges.
const LATEST_BADGE_BATCH = '2026-07-16';

export function compute(n) {
  const s = String(n);
  const d = [...s].map(ch => ch.charCodeAt(0) - 48);
  const counts = {};
  for (const x of d) counts[x] = (counts[x] || 0) + 1;
  const c = {
    n, s, len: s.length, d, counts,
    distinct: Object.keys(counts).length,
    sum: d.reduce((a, b) => a + b, 0),
    prod: d.reduce((a, b) => a * b, 1),
    maxCount: Math.max(...Object.values(counts)),
    has: sub => s.includes(sub),
    cnt: digit => counts[digit] || 0,
    withCount: k => Object.values(counts).filter(v => v >= k).length,
    countExact: k => Object.values(counts).filter(v => v === k).length,
    runs: runLengths(s),
  };
  const earned = [];
  for (const [id, label, emoji, ep, test] of BADGES) {
    let ok = false;
    try { ok = test(c); } catch (e) { ok = false; }
    if (ok) earned.push({ id, label, emoji, ep, rarity: rarityFromScore(ep), desc: DESCRIPTIONS[id], prob: PROBABILITIES[id] });
  }
  // Apply family supersession: within each family, only the highest-EP earned badge scores;
  // the rest stay in the earned list (displayed) but score 0. Matches prod's max-score-wins.
  for (const fam of FAMILIES) {
    const members = earned.filter(b => fam.includes(b.id));
    if (members.length < 2) continue;
    let top = members[0];
    for (const b of members) if (b.ep > top.ep) top = b;
    for (const b of members) if (b !== top) b.ep = 0;
  }
  const total = earned.reduce((s, b) => s + b.ep, 0);
  earned.sort((a, b) => b.ep - a.ep);
  return { number: n, totalEP: total, count: earned.length, badges: earned };
}
