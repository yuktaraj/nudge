import type { NounGroup, StemmedTerm, Token } from './types';

const ENGLISH_STOP_WORDS: Set<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare',
  'ought', 'used', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'because', 'if', 'while', 'about',
  'between', 'through', 'during', 'before', 'after', 'above', 'below',
  'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'also', 'into', 'until', 'against',
  'any', 'am',
]);

const NOUN_SUFFIXES: Array<{ suffix: string; minLen: number }> = [
  { suffix: 'tion', minLen: 5 }, { suffix: 'sion', minLen: 5 },
  { suffix: 'ment', minLen: 5 }, { suffix: 'ness', minLen: 5 },
  { suffix: 'ity', minLen: 4 }, { suffix: 'ity', minLen: 4 },
  { suffix: 'ism', minLen: 4 }, { suffix: 'ist', minLen: 4 },
  { suffix: 'ness', minLen: 4 }, { suffix: 'ity', minLen: 4 },
  { suffix: 'ous', minLen: 4 }, { suffix: 'ive', minLen: 4 },
  { suffix: 'able', minLen: 5 }, { suffix: 'ible', minLen: 5 },
  { suffix: 'less', minLen: 5 }, { suffix: 'ment', minLen: 5 },
  { suffix: 'ence', minLen: 5 }, { suffix: 'ance', minLen: 5 },
  { suffix: 'ism', minLen: 3 }, { suffix: 'ist', minLen: 3 },
  { suffix: 'ist', minLen: 3 }, { suffix: 'ate', minLen: 4 },
  { suffix: 'ize', minLen: 4 }, { suffix: 'ise', minLen: 4 },
  { suffix: 'ure', minLen: 4 }, { suffix: 'age', minLen: 3 },
  { suffix: 'dom', minLen: 4 }, { suffix: 'ship', minLen: 5 },
  { suffix: 'hood', minLen: 4 }, { suffix: 'kind', minLen: 4 },
  { suffix: 'sort', minLen: 4 }, { suffix: 'form', minLen: 4 },
];

const ADJECTIVE_SUFFIXES: string[] = [
  'ive', 'able', 'ible', 'ous', 'ful', 'less', 'al', 'ial', 'ic',
  'ical', 'ish', 'y', 'ish', 'like', 'wise', 'bound', 'some',
];

export interface PreprocessingOptions {
  removeStopWords?: boolean;
  stemWords?: boolean;
  lemmatize?: boolean;
  identifyNounGroups?: boolean;
  tokenize?: boolean;
  lowercase?: boolean;
  stopWords?: Set<string>;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const regex = /(\w+)|(\d+)|([^\w\s]+)|(\s+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const position = match.index;
    if (match[1]) {
      tokens.push({ value: match[1], position, type: 'word' });
    } else if (match[2]) {
      tokens.push({ value: match[2], position, type: 'number' });
    } else if (match[3]) {
      tokens.push({ value: match[3], position, type: 'punctuation' });
    } else if (match[4]) {
      tokens.push({ value: match[4], position, type: 'whitespace' });
    }
  }

  return tokens;
}

function isNounCandidate(word: string, tokens: Token[], index: number): boolean {
  if (word.length < 2) return false;
  const lower = word.toLowerCase();

  if (ENGLISH_STOP_WORDS.has(lower)) return false;

  if (
    word[0] === word[0].toUpperCase() &&
    word !== word.toUpperCase() &&
    index > 0
  ) {
    const prevToken = tokens[index - 1];
    if (prevToken && prevToken.type === 'word') {
      const prevLower = prevToken.value.toLowerCase();
      if (
        prevLower === 'the' || prevLower === 'a' || prevLower === 'an' ||
        prevLower === 'this' || prevLower === 'that' || prevLower === 'these' ||
        prevLower === 'those' || prevLower === 'my' || prevLower === 'your' ||
        prevLower === 'our' || prevLower === 'his' || prevLower === 'her'
      ) {
        return true;
      }
    }
    if (index === 0 || tokens[index - 1].type !== 'word') {
      return true;
    }
  }

  for (const { suffix, minLen } of NOUN_SUFFIXES) {
    if (lower.length >= minLen && lower.endsWith(suffix)) return true;
  }

  return false;
}

export function identifyNounGroups(
  text: string,
  _options?: PreprocessingOptions
): NounGroup[] {
  const tokens = tokenize(text);
  const groups: NounGroup[] = [];
  let currentGroup: Token[] = [];
  let groupStart = -1;

  function flushGroup(): void {
    if (currentGroup.length >= 1) {
      groups.push({
        text: currentGroup.map((t) => t.value).join(' '),
        startIndex: groupStart,
        endIndex: currentGroup[currentGroup.length - 1].position +
          currentGroup[currentGroup.length - 1].value.length,
        tokens: [...currentGroup],
      });
    }
    currentGroup = [];
    groupStart = -1;
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'word') {
      flushGroup();
      continue;
    }

    if (isNounCandidate(token.value, tokens, i)) {
      if (currentGroup.length === 0) groupStart = token.position;
      currentGroup.push(token);
    } else {
      const lower = token.value.toLowerCase();
      const prevIsAdj =
        currentGroup.length > 0 &&
        ADJECTIVE_SUFFIXES.some((s) =>
          currentGroup[currentGroup.length - 1].value.toLowerCase().endsWith(s)
        );
      if (
        (lower === 'of' || lower === 'for' || lower === 'in' ||
          lower === 'on' || lower === 'with' || lower === 'from' ||
          lower === 'to' || lower === 'by' || lower === 'and' ||
          lower === 'or' || lower === 'but' || lower === 'vs' ||
          lower === 'like' || lower === 'including' || lower === 'about') &&
        prevIsAdj
      ) {
        currentGroup.push(token);
      } else {
        flushGroup();
      }
    }
  }
  flushGroup();

  return groups;
}

const PORTER_STEP1A: Array<[RegExp, RegExp, string]> = [
  [/(?:(?<!S)SS)$/, /(S?)$/, ''],
  [/(?:(?<!S)S)$/, /(S)$/, ''],
];

const PORTER_STEP1B: Array<[RegExp, string]> = [
  [/(eed)$/, 'ee'],
  [/(ed|ing)$/, ''],
];

const PORTER_STEP1C: [RegExp, string] = [/^(?:(?<!Y)([AEIOUY]))y$/, '$1i'];

const PORTER_STEP2: Array<[RegExp, string]> = [
  [/(ational)$/, 'ate'],
  [/(tional)$/, 'tional'],
  [/(enci)$/, 'ence'],
  [/(anci)$/, 'ance'],
  [/(izer)$/, 'ize'],
  [/(abli)$/, 'able'],
  [/(alli)$/, 'al'],
  [/(entli)$/, 'ent'],
  [/(eli)$/, 'e'],
  [/(ousli)$/, 'ous'],
  [/(ization)$/, 'ize'],
  [/(ation)$/, 'ate'],
  [/(ator)$/, 'ate'],
  [/(alism)$/, 'al'],
  [/(iveness)$/, 'ive'],
  [/(fulness)$/, 'ful'],
  [/(ousness)$/, 'ous'],
  [/(aliti)$/, 'al'],
  [/(iviti)$/, 'ive'],
  [/(biliti)$/, 'ble'],
];

const PORTER_STEP3: Array<[RegExp, string]> = [
  [/(icate)$/, 'ic'],
  [/(ative)$/, ''],
  [/(alize)$/, 'al'],
  [/(iciti)$/, 'ic'],
  [/(ical)$/, 'ic'],
  [/(ful)$/, ''],
  [/(ness)$/, ''],
];

const PORTER_STEP4: Array<[RegExp, string, RegExp]> = [
  [/(al)$/, 'al', /(ance|ence)$/],
  [/(er)$/, 'er', /(ance|ence)$/],
  [/(ic)$/, 'ic', /(ance|ence)$/],
  [/(able)$/, 'able', /(ance|ence)$/],
  [/(ible)$/, 'ible', /(ance|ence)$/],
  [/(al)$/, 'al', /al$/],
  [/(er)$/, 'er', /er$/],
  [/(ic)$/, 'ic', /ic$/],
];

const PORTER_STEP5A: [RegExp, RegExp, string] = [
  /(e)$/,
  /(ll)$/,
  'e',
];

const PORTER_STEP5B: [RegExp, string] = [/(ed|ing)$/, ''];

export function stemWord(word: string): string {
  if (word.length < 3) return word;
  let w = word.toLowerCase();

  for (const [re, _re2, rep] of PORTER_STEP1A) {
    if (re.test(w)) {
      w = w.replace(re, rep);
      break;
    }
  }

  for (const [re, rep] of PORTER_STEP1B) {
    if (re.test(w)) {
      const stem = w.slice(0, w.length - re.exec(w)![1].length);
      if (/(at|bl|iz)$/.test(stem) || /([ZYS])$/.test(stem) || /(LL)$/.test(stem)) {
        w = stem + 'E';
      } else {
        w = stem;
      }
      break;
    }
  }

  if (PORTER_STEP1C[0].test(w)) {
    w = w.replace(PORTER_STEP1C[0], PORTER_STEP1C[1]);
  }

  for (const [re, rep] of PORTER_STEP2) {
    if (re.test(w)) {
      w = w.replace(re, rep);
      break;
    }
  }

  for (const [re, rep] of PORTER_STEP3) {
    if (re.test(w)) {
      w = w.replace(re, rep);
      break;
    }
  }

  for (const [re, rep, condRe] of PORTER_STEP4) {
    if (re.test(w) && condRe.test(w)) {
      w = w.replace(re, rep);
      break;
    }
  }

  if (PORTER_STEP5A[0].test(w) && !PORTER_STEP5A[1].test(w)) {
    w = w.replace(PORTER_STEP5A[0], PORTER_STEP5A[2]);
  }

  if (PORTER_STEP5B[0].test(w)) {
    const stem = w.slice(0, w.length - PORTER_STEP5B[0].exec(w)![1].length);
    if (stem.length > 1) {
      w = stem;
    }
  }

  return w;
}

export function preprocessDocument(
  text: string,
  options: PreprocessingOptions = {}
): { tokens: Token[]; filteredTokens: string[]; nounGroups: NounGroup[]; stemmedTerms: StemmedTerm[] } {
  const {
    removeStopWords = true,
    stemWords = false,
    identifyNounGroups: findNouns = false,
    lowercase = true,
    stopWords,
  } = options;

  const tokens = tokenize(text);
  const customStopWords = stopWords ?? ENGLISH_STOP_WORDS;

  let filteredTokens: string[] = tokens
    .filter((t) => t.type === 'word' || t.type === 'number')
    .map((t) => (lowercase ? t.value.toLowerCase() : t.value));

  if (removeStopWords) {
    filteredTokens = filteredTokens.filter((t) => !customStopWords.has(t.toLowerCase()));
  }

  if (stemWords) {
    filteredTokens = filteredTokens.map((t) => stemWord(t));
  }

  const nounGroups = findNouns ? identifyNounGroups(text, options) : [];
  const stemmedTerms: StemmedTerm[] = filteredTokens.map((t) => ({
    original: t,
    stem: stemWord(t),
  }));

  return { tokens, filteredTokens, nounGroups, stemmedTerms };
}

export { tokenize, ENGLISH_STOP_WORDS };
