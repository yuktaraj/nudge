import type { TermDocumentMatrix, InvertedIndex, Posting } from './types';
import { tokenize } from './preprocessing';
import { InvertedIndexBuilder } from './indexing';

export class BooleanModel {
  private index: InvertedIndex;
  private docIds: string[];

  constructor(index: InvertedIndex) {
    this.index = index;
    this.docIds = [...index.docIds];
  }

  private getPostings(term: string): Posting[] {
    return this.index.terms.get(term.toLowerCase()) ?? [];
  }

  static fromDocuments(
    documents: Array<{ id: string; text: string }>
  ): BooleanModel {
    const builder = new InvertedIndexBuilder();
    for (const doc of documents) {
      builder.indexDocument(doc.id, doc.text);
    }
    return new BooleanModel(builder.getIndex());
  }

  evaluate(query: string): Set<string> {
    const ast = this.parse(query);
    return this.evaluateAST(ast);
  }

  private parse(query: string): BooleanAST {
    const tokens = this.tokenizeQuery(query);
    let position = 0;

    function peek(): QueryToken | null {
      return position < tokens.length ? tokens[position] : null;
    }

    function consume(type?: QueryToken['type']): QueryToken {
      const token = peek();
      if (!token) throw new Error('Unexpected end of query');
      if (type && token.type !== type) {
        throw new Error(`Expected ${type}, got ${token.type}`);
      }
      position++;
      return token;
    }

    function parsePrimary(): BooleanAST {
      const token = peek();
      if (!token) throw new Error('Unexpected end of query');

      if (token.type === 'TERM') {
        consume('TERM');
        return { type: 'TERM', value: token.value.toLowerCase() };
      }

      if (token.type === 'LPAREN') {
        consume('LPAREN');
        const expr = parseExpression();
        consume('RPAREN');
        return expr;
      }

      if (token.type === 'NOT') {
        consume('NOT');
        return { type: 'NOT', left: parsePrimary() };
      }

      throw new Error(`Unexpected token: ${token.value}`);
    }

    function parseAnd(): BooleanAST {
      let left = parsePrimary();
      while (peek()?.type === 'AND') {
        consume('AND');
        left = { type: 'AND', left, right: parsePrimary() };
      }
      return left;
    }

    function parseOr(): BooleanAST {
      let left = parseAnd();
      while (peek()?.type === 'OR') {
        consume('OR');
        left = { type: 'OR', left, right: parseAnd() };
      }
      return left;
    }

    function parseExpression(): BooleanAST {
      return parseOr();
    }

    const ast = parseExpression();
    if (position < tokens.length) {
      throw new Error('Extra tokens after end of query');
    }
    return ast;
  }

  private tokenizeQuery(query: string): QueryToken[] {
    const tokens: QueryToken[] = [];
    let i = 0;

    while (i < query.length) {
      const ch = query[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (ch === '(') {
        tokens.push({ type: 'LPAREN', value: '(' });
        i++;
      } else if (ch === ')') {
        tokens.push({ type: 'RPAREN', value: ')' });
        i++;
      } else if (query.slice(i, i + 3).toUpperCase() === 'AND') {
        tokens.push({ type: 'AND', value: 'AND' });
        i += 3;
      } else if (query.slice(i, i + 2).toUpperCase() === 'OR') {
        tokens.push({ type: 'OR', value: 'OR' });
        i += 2;
      } else if (query.slice(i, i + 3).toUpperCase() === 'NOT') {
        tokens.push({ type: 'NOT', value: 'NOT' });
        i += 3;
      } else {
        let term = '';
        while (i < query.length && !/\s/.test(query[i]) && !['(', ')'].includes(query[i])) {
          if (
            query.slice(i, i + 3).toUpperCase() === 'AND' ||
            query.slice(i, i + 2).toUpperCase() === 'OR' ||
            query.slice(i, i + 3).toUpperCase() === 'NOT'
          ) break;
          term += query[i++];
        }
        if (term) tokens.push({ type: 'TERM', value: term });
      }
    }
    return tokens;
  }

  private evaluateAST(ast: BooleanAST): Set<string> {
    switch (ast.type) {
      case 'TERM':
        return new Set(this.getPostings(ast.value).map((p: Posting) => p.docId));
      case 'NOT':
        return this.setDifference(this.universe(), this.evaluateAST(ast.left!));
      case 'AND':
        return this.setIntersection(
          this.evaluateAST(ast.left!),
          this.evaluateAST(ast.right!)
        );
      case 'OR':
        return this.setUnion(
          this.evaluateAST(ast.left!),
          this.evaluateAST(ast.right!)
        );
    }
  }

  private universe(): Set<string> {
    return new Set(this.docIds);
  }

  private setIntersection(a: Set<string>, b: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const item of a) if (b.has(item)) result.add(item);
    return result;
  }

  private setUnion(a: Set<string>, b: Set<string>): Set<string> {
    return new Set([...a, ...b]);
  }

  private setDifference(a: Set<string>, b: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const item of a) if (!b.has(item)) result.add(item);
    return result;
  }

  toTermDocumentMatrix(): TermDocumentMatrix {
    const terms = [...this.index.terms.keys()].sort();
    const docIds = [...this.index.docIds].sort();
    const matrix: boolean[][] = [];

    for (const term of terms) {
      const postings = this.getPostings(term);
      const docSet = new Set(postings.map((p: Posting) => p.docId));
      const row = docIds.map((docId) => docSet.has(docId));
      matrix.push(row);
    }

    return { terms, docIds, matrix };
  }

  evaluateTermFrequency(query: string, topK = 10): Array<{ docId: string; score: number }> {
    const result = this.evaluate(query);
    const docScores = new Map<string, number>();

    for (const docId of result) {
      const queryTerms = tokenize(query).filter((t) => t.type === 'word').map((t) => t.value.toLowerCase());
      let score = 0;
      for (const term of queryTerms) {
        const posting = this.getPostings(term).find((p: Posting) => p.docId === docId);
        if (posting) score += posting.termFrequency;
      }
      docScores.set(docId, score);
    }

    return [...docScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([docId, score]) => ({ docId, score }));
  }
}

interface QueryToken {
  type: 'TERM' | 'AND' | 'OR' | 'NOT' | 'LPAREN' | 'RPAREN';
  value: string;
}

type BooleanAST =
  | { type: 'TERM'; value: string }
  | { type: 'NOT'; left: BooleanAST }
  | { type: 'AND' | 'OR'; left: BooleanAST; right: BooleanAST };