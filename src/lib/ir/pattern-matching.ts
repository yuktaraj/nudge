import type { PatternMatchResult, PatternMatch, SuffixArrayEntry } from './types';
import { SuffixArray } from './indexing';

export function exactMatch(
  documents: Array<{ id: string; text: string }>,
  pattern: string
): PatternMatchResult {
  const matches: PatternMatch[] = [];
  const lowerPattern = pattern.toLowerCase();

  for (const doc of documents) {
    const lowerText = doc.text.toLowerCase();
    let index = lowerText.indexOf(lowerPattern);
    while (index !== -1) {
      matches.push({
        docId: doc.id,
        text: doc.text,
        startIndex: index,
        endIndex: index + pattern.length,
        matchedText: doc.text.slice(index, index + pattern.length),
      });
      index = lowerText.indexOf(lowerPattern, index + 1);
    }
  }

  return { pattern, matches };
}

export function prefixMatch(
  documents: Array<{ id: string; text: string }>,
  prefix: string
): PatternMatchResult {
  const matches: PatternMatch[] = [];
  const lowerPrefix = prefix.toLowerCase();

  for (const doc of documents) {
    const words = doc.text.toLowerCase().match(/\w+/g) ?? [];
    let charIndex = 0;
    for (const word of words) {
      if (word.startsWith(lowerPrefix)) {
        const index = doc.text.toLowerCase().indexOf(word, charIndex);
        if (index !== -1) {
          matches.push({
            docId: doc.id,
            text: doc.text,
            startIndex: index,
            endIndex: index + word.length,
            matchedText: doc.text.slice(index, index + word.length),
          });
        }
      }
      charIndex = doc.text.toLowerCase().indexOf(word, charIndex) + word.length;
    }
  }

  return { pattern: prefix + '*', matches };
}

export function suffixMatch(
  documents: Array<{ id: string; text: string }>,
  suffix: string
): PatternMatchResult {
  const matches: PatternMatch[] = [];
  const lowerSuffix = suffix.toLowerCase();

  for (const doc of documents) {
    const words = doc.text.toLowerCase().match(/\w+/g) ?? [];
    let charIndex = 0;
    for (const word of words) {
      if (word.endsWith(lowerSuffix)) {
        const index = doc.text.toLowerCase().indexOf(word, charIndex);
        if (index !== -1) {
          matches.push({
            docId: doc.id,
            text: doc.text,
            startIndex: index,
            endIndex: index + word.length,
            matchedText: doc.text.slice(index, index + word.length),
          });
        }
      }
      charIndex = doc.text.toLowerCase().indexOf(word, charIndex) + word.length;
    }
  }

  return { pattern: '*' + suffix, matches };
}

export function substringMatch(
  documents: Array<{ id: string; text: string }>,
  substring: string
): PatternMatchResult {
  const matches: PatternMatch[] = [];
  const lowerSub = substring.toLowerCase();

  for (const doc of documents) {
    const lowerText = doc.text.toLowerCase();
    let index = lowerText.indexOf(lowerSub);
    while (index !== -1) {
      matches.push({
        docId: doc.id,
        text: doc.text,
        startIndex: index,
        endIndex: index + substring.length,
        matchedText: doc.text.slice(index, index + substring.length),
      });
      index = lowerText.indexOf(lowerSub, index + 1);
    }
  }

  return { pattern: substring, matches };
}

export function kmpSearch(text: string, pattern: string): number[] {
  const results: number[] = [];
  if (!pattern || !text) return results;

  const lps = buildLPSArray(pattern);
  let i = 0;
  let j = 0;

  while (i < text.length) {
    if (text[i] === pattern[j]) {
      i++;
      j++;
      if (j === pattern.length) {
        results.push(i - j);
        j = lps[j - 1];
      }
    } else {
      if (j !== 0) {
        j = lps[j - 1];
      } else {
        i++;
      }
    }
  }

  return results;
}

function buildLPSArray(pattern: string): number[] {
  const lps = new Array(pattern.length).fill(0);
  let len = 0;
  let i = 1;

  while (i < pattern.length) {
    if (pattern[i] === pattern[len]) {
      len++;
      lps[i] = len;
      i++;
    } else {
      if (len !== 0) {
        len = lps[len - 1];
      } else {
        lps[i] = 0;
        i++;
      }
    }
  }

  return lps;
}

export function boyerMooreSearch(text: string, pattern: string): number[] {
  const results: number[] = [];
  if (!pattern || !text) return results;

  const badChar = buildBadCharTable(pattern);
  const goodSuffix = buildGoodSuffixTable(pattern);

  let i = 0;
  while (i <= text.length - pattern.length) {
    let j = pattern.length - 1;

    while (j >= 0 && pattern[j] === text[i + j]) {
      j--;
    }

    if (j < 0) {
      results.push(i);
      i += pattern.length > 1 ? goodSuffix[0] : 1;
    } else {
      const bcShift = Math.max(1, j - (badChar.get(text[i + j]) ?? -1));
      const gsShift = goodSuffix[j];
      i += Math.max(bcShift, gsShift);
    }
  }

  return results;
}

function buildBadCharTable(pattern: string): Map<string, number> {
  const table = new Map<string, number>();
  for (let i = 0; i < pattern.length; i++) {
    table.set(pattern[i], i);
  }
  return table;
}

function buildGoodSuffixTable(pattern: string): number[] {
  const m = pattern.length;
  const table = new Array(m).fill(m);
  const border = new Array(m + 1).fill(0);

  let i = m;
  let j = m + 1;
  border[i] = j;

  while (i > 0) {
    while (j <= m && pattern[i - 1] !== pattern[j - 1]) {
      if (table[j - 1] === m) table[j - 1] = j - i;
      j = border[j];
    }
    i--;
    j--;
    border[i] = j;
  }

  j = border[0];
  for (i = 0; i <= m; i++) {
    if (table[i] === m) table[i] = j;
    if (i === j) j = border[j];
  }

  return table;
}

export function suffixArraySearch(
  documents: Array<{ id: string; text: string }>,
  pattern: string
): PatternMatchResult {
  const matches: PatternMatch[] = [];

  for (const doc of documents) {
    const sa = new SuffixArray();
    sa.build(doc.text);
    const indices = sa.search(pattern);
    for (const idx of indices) {
      matches.push({
        docId: doc.id,
        text: doc.text,
        startIndex: idx,
        endIndex: idx + pattern.length,
        matchedText: doc.text.slice(idx, idx + pattern.length),
      });
    }
  }

  return { pattern, matches };
}

export function lexicalRangeSearch(
  documents: Array<{ id: string; text: string }>,
  startTerm: string,
  endTerm: string
): PatternMatchResult {
  const matches: PatternMatch[] = [];
  const start = startTerm.toLowerCase();
  const end = endTerm.toLowerCase();

  for (const doc of documents) {
    const words = doc.text.toLowerCase().match(/\w+/g) ?? [];
    const uniqueWords = [...new Set(words)].sort();

    const startIdx = uniqueWords.findIndex((w) => w >= start);
    const endIdx = uniqueWords.findIndex((w) => w > end);

    const rangeWords = uniqueWords.slice(
      startIdx >= 0 ? startIdx : 0,
      endIdx >= 0 ? endIdx : uniqueWords.length
    );

    for (const word of rangeWords) {
      let index = doc.text.toLowerCase().indexOf(word);
      while (index !== -1) {
        matches.push({
          docId: doc.id,
          text: doc.text,
          startIndex: index,
          endIndex: index + word.length,
          matchedText: doc.text.slice(index, index + word.length),
        });
        index = doc.text.toLowerCase().indexOf(word, index + 1);
      }
    }
  }

  return { pattern: `[${startTerm}..${endTerm}]`, matches };
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

export function fuzzyMatch(
  documents: Array<{ id: string; text: string }>,
  pattern: string,
  maxDistance = 2
): PatternMatchResult {
  const matches: PatternMatch[] = [];
  const lowerPattern = pattern.toLowerCase();

  for (const doc of documents) {
    const words = doc.text.toLowerCase().match(/\w+/g) ?? [];
    let charIndex = 0;

    for (const word of words) {
      const dist = levenshteinDistance(word, lowerPattern);
      if (dist <= maxDistance) {
        const index = doc.text.toLowerCase().indexOf(word, charIndex);
        if (index !== -1) {
          matches.push({
            docId: doc.id,
            text: doc.text,
            startIndex: index,
            endIndex: index + word.length,
            matchedText: doc.text.slice(index, index + word.length),
            distance: dist,
          });
        }
      }
      charIndex = doc.text.toLowerCase().indexOf(word, charIndex) + word.length;
    }
  }

  matches.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  return { pattern: `~${pattern}`, matches };
}

export function regexMatch(
  documents: Array<{ id: string; text: string }>,
  regex: string | RegExp,
  flags = 'gi'
): PatternMatchResult {
  const matches: PatternMatch[] = [];
  const pattern = typeof regex === 'string' ? new RegExp(regex, flags) : regex;

  for (const doc of documents) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(doc.text)) !== null) {
      matches.push({
        docId: doc.id,
        text: doc.text,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        matchedText: match[0],
      });
      if (match[0].length === 0) break;
    }
    pattern.lastIndex = 0;
  }

  return { pattern: regex.toString(), matches };
}

export function wildcardMatch(
  documents: Array<{ id: string; text: string }>,
  pattern: string
): PatternMatchResult {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return regexMatch(documents, new RegExp('^' + regex + '$', 'i'));
}

export function multiPatternMatch(
  documents: Array<{ id: string; text: string }>,
  patterns: string[],
  type: 'exact' | 'prefix' | 'suffix' | 'substring' | 'fuzzy' | 'regex' = 'substring',
  options: { maxDistance?: number } = {}
): PatternMatchResult {
  const allMatches: PatternMatch[] = [];

  for (const pattern of patterns) {
    let result: PatternMatchResult;
    switch (type) {
      case 'exact':
        result = exactMatch(documents, pattern);
        break;
      case 'prefix':
        result = prefixMatch(documents, pattern);
        break;
      case 'suffix':
        result = suffixMatch(documents, pattern);
        break;
      case 'substring':
        result = substringMatch(documents, pattern);
        break;
      case 'fuzzy':
        result = fuzzyMatch(documents, pattern, options.maxDistance ?? 2);
        break;
      case 'regex':
        result = regexMatch(documents, pattern);
        break;
    }
    allMatches.push(...result.matches);
  }

  allMatches.sort((a, b) => a.docId.localeCompare(b.docId) || a.startIndex - b.startIndex);
  return { pattern: patterns.join(' | '), matches: allMatches };
}