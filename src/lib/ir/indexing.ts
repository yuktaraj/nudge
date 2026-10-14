import type { InvertedIndex, Posting, SuffixArrayEntry } from './types';
export type { InvertedIndex, Posting, SuffixArrayEntry };
import { tokenize, preprocessDocument } from './preprocessing';

export class InvertedIndexBuilder {
  private terms: Map<string, Posting[]> = new Map();
  private docIds: Set<string> = new Set();
  private docLengths: Map<string, number> = new Map();

  indexDocument(docId: string, text: string, useStemming = false): void {
    this.docIds.add(docId);
    const tokens = tokenize(text);
    const wordTokens = tokens.filter((t) => t.type === 'word');
    this.docLengths.set(docId, wordTokens.length);

    const positionsByTerm = new Map<string, number[]>();

    for (let i = 0; i < wordTokens.length; i++) {
      const raw = wordTokens[i].value;
      const term = useStemming ? raw.toLowerCase() : raw.toLowerCase();
      const key = useStemming ? term : term;

      if (!positionsByTerm.has(key)) {
        positionsByTerm.set(key, []);
      }
      positionsByTerm.get(key)!.push(i);
    }

    for (const [term, positions] of positionsByTerm) {
      if (!this.terms.has(term)) {
        this.terms.set(term, []);
      }
      const postings = this.terms.get(term)!;
      const existing = postings.find((p) => p.docId === docId);
      if (existing) {
        existing.termFrequency += positions.length;
        existing.positions.push(...positions);
      } else {
        postings.push({ docId, termFrequency: positions.length, positions: [...positions] });
      }
    }
  }

  indexDocumentPreprocessed(docId: string, text: string): void {
    this.indexDocument(docId, text, false);
  }

  getIndex(): InvertedIndex {
    return {
      terms: this.terms,
      docIds: this.docIds,
      docLengths: this.docLengths,
    };
  }

  getPostings(term: string): Posting[] {
    return this.terms.get(term.toLowerCase()) ?? [];
  }

  getDocumentCount(): number {
    return this.docIds.size;
  }

  getTermCount(): number {
    return this.terms.size;
  }

  getDocumentFrequency(term: string): number {
    return this.getPostings(term).length;
  }

  getTerms(): string[] {
    return [...this.terms.keys()];
  }

  getDocIds(): string[] {
    return [...this.docIds];
  }

  clear(): void {
    this.terms.clear();
    this.docIds.clear();
    this.docLengths.clear();
  }
}

export class SuffixArray {
  private entries: SuffixArrayEntry[] = [];
  private text: string = '';

  build(text: string): void {
    this.text = text;
    const n = text.length;
    this.entries = [];
    for (let i = 0; i < n; i++) {
      this.entries.push({ suffix: text.slice(i), index: i });
    }
    this.entries.sort((a, b) => a.suffix.localeCompare(b.suffix));
  }

  search(pattern: string): number[] {
    const results: number[] = [];
    const n = this.entries.length;
    if (n === 0 || pattern.length === 0) return results;

    let low = 0;
    let high = n - 1;
    let first = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const suffix = this.entries[mid].suffix;
      const compare = this.comparePrefix(suffix, pattern);
      if (compare === 0) {
        first = mid;
        high = mid - 1;
      } else if (compare < 0) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (first === -1) return results;

    low = first;
    high = n - 1;
    let last = first;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const suffix = this.entries[mid].suffix;
      const compare = this.comparePrefix(suffix, pattern);
      if (compare === 0) {
        last = mid;
        low = mid + 1;
      } else if (compare < 0) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    for (let i = first; i <= last; i++) {
      results.push(this.entries[i].index);
    }
    return results.sort((a, b) => a - b);
  }

  private comparePrefix(suffix: string, pattern: string): number {
    const minLen = Math.min(suffix.length, pattern.length);
    for (let i = 0; i < minLen; i++) {
      if (suffix[i] !== pattern[i]) {
        return suffix[i].charCodeAt(0) - pattern[i].charCodeAt(0);
      }
    }
    if (suffix.length < pattern.length) return -1;
    if (suffix.length > pattern.length) return 1;
    return 0;
  }

  startWith(prefix: string): string[] {
    return this.search(prefix).map((i) => this.text.slice(i));
  }

  endsWith(suffix: string): number[] {
    const results: number[] = [];
    for (let i = 0; i < this.text.length; i++) {
      if (this.text.slice(i).endsWith(suffix)) {
        results.push(i);
      }
    }
    return results.sort((a, b) => a - b);
  }

  getEntries(): SuffixArrayEntry[] {
    return [...this.entries];
  }

  getText(): string {
    return this.text;
  }
}

export class SuffixTree {
  private root: SuffixTreeNode = { children: {}, indices: [] };
  private text: string = '';

  build(text: string): void {
    this.text = text;
    this.root = { children: {}, indices: [] };
    const n = text.length;
    for (let i = 0; i < n; i++) {
      let node = this.root;
      for (let j = i; j < n; j++) {
        const ch = text[j];
        if (!node.children[ch]) {
          node.children[ch] = { children: {}, indices: [] };
        }
        node = node.children[ch];
        node.indices.push(i);
      }
      node.indices.push(i);
    }
  }

  search(pattern: string): number[] {
    let node: SuffixTreeNode = this.root;
    for (const ch of pattern) {
      if (!node.children[ch]) return [];
      node = node.children[ch];
    }
    return [...node.indices];
  }

  substringExists(pattern: string): boolean {
    return this.search(pattern).length > 0;
  }

  private getNode(pattern: string): SuffixTreeNode | null {
    let node: SuffixTreeNode = this.root;
    for (const ch of pattern) {
      if (!node.children[ch]) return null;
      node = node.children[ch];
    }
    return node;
  }

  allSubstrings(): string[] {
    const results: string[] = [];
    this.collectStrings(this.root, '', results);
    return results;
  }

  private collectStrings(node: SuffixTreeNode, prefix: string, results: string[]): void {
    if (prefix.length > 0) results.push(prefix);
    for (const [ch, child] of Object.entries(node.children)) {
      this.collectStrings(child, prefix + ch, results);
    }
  }
}

interface SuffixTreeNode {
  children: Record<string, SuffixTreeNode>;
  indices: number[];
}

export function buildInvertedIndexFromDocuments(
  documents: Array<{ id: string; text: string }>,
  useStemming = false
): InvertedIndexBuilder {
  const builder = new InvertedIndexBuilder();
  for (const doc of documents) {
    builder.indexDocument(doc.id, doc.text, useStemming);
  }
  return builder;
}

function getIndexPostings(index: InvertedIndex | InvertedIndexBuilder, term: string): Posting[] {
  if (index instanceof InvertedIndexBuilder) {
    return index.getPostings(term);
  }
  return index.terms.get(term.toLowerCase()) ?? [];
}

export function searchInvertedIndex(
  index: InvertedIndex | InvertedIndexBuilder,
  query: string,
  useAnd = true
): Map<string, number> {
  const terms = tokenize(query).filter((t) => t.type === 'word').map((t) => t.value.toLowerCase());
  if (terms.length === 0) return new Map();

  const docScores = new Map<string, number>();

  if (useAnd) {
    const firstPostings = getIndexPostings(index, terms[0]);
    for (const posting of firstPostings) {
      let allPresent = true;
      for (let i = 1; i < terms.length; i++) {
        if (!getIndexPostings(index, terms[i]).some((p: Posting) => p.docId === posting.docId)) {
          allPresent = false;
          break;
        }
      }
      if (allPresent) {
        docScores.set(posting.docId, posting.termFrequency);
      }
    }
  } else {
    for (const term of terms) {
      for (const posting of getIndexPostings(index, term)) {
        const current = docScores.get(posting.docId) ?? 0;
        docScores.set(posting.docId, current + posting.termFrequency);
      }
    }
  }

  return docScores;
}
