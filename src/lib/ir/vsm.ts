import type { TFIDFVector, InvertedIndex, Posting } from './types';
import { InvertedIndexBuilder } from './indexing';

export class VectorSpaceModel {
  private documents: Array<{ id: string; text: string }> = [];
  private invertedIndex: InvertedIndex = {
    terms: new Map(),
    docIds: new Set(),
    docLengths: new Map(),
  };
  private tfidfVectors: TFIDFVector[] = [];
  private termIdf: Map<string, number> = new Map();
  private docLengths: Map<string, number> = new Map();
  private vocabulary: string[] = [];

  constructor(documents: Array<{ id: string; text: string }> = []) {
    if (documents.length > 0) {
      this.addDocuments(documents);
    }
  }

  addDocuments(documents: Array<{ id: string; text: string }>): void {
    this.documents = documents;
    this.buildIndex();
  }

  private buildIndex(): void {
    const builder = new InvertedIndexBuilder();
    for (const doc of this.documents) {
      builder.indexDocument(doc.id, doc.text);
    }
    this.invertedIndex = builder.getIndex();
    this.vocabulary = [...this.invertedIndex.terms.keys()].sort();
    this.computeIDF();
    this.computeTFIDFVectors();
  }

  private computeIDF(): void {
    const N = this.documents.length;
    for (const term of this.vocabulary) {
      const df = this.invertedIndex.terms.get(term)?.length ?? 0;
      this.termIdf.set(term, df > 0 ? Math.log(N / df) : 0);
    }
  }

  private computeTFIDFVectors(): void {
    this.tfidfVectors = [];
    for (const doc of this.documents) {
      const vector = new Map<string, number>();
      const tokens = doc.text.toLowerCase().match(/\w+/g) ?? [];
      const termFreq = new Map<string, number>();

      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }

      for (const [term, tf] of termFreq) {
        const idf = this.termIdf.get(term) ?? 0;
        vector.set(term, tf * idf);
      }

      const norm = Math.sqrt([...vector.values()].reduce((sum, v) => sum + v * v, 0));
      if (norm > 0) {
        for (const [term, value] of vector) {
          vector.set(term, value / norm);
        }
      }

      this.tfidfVectors.push({ docId: doc.id, vector });
    }
  }

  private vectorizeQuery(query: string): Map<string, number> {
    const vector = new Map<string, number>();
    const tokens = query.toLowerCase().match(/\w+/g) ?? [];
    const termFreq = new Map<string, number>();

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    for (const [term, tf] of termFreq) {
      const idf = this.termIdf.get(term) ?? 0;
      vector.set(term, tf * idf);
    }

    const norm = Math.sqrt([...vector.values()].reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (const [term, value] of vector) {
        vector.set(term, value / norm);
      }
    }

    return vector;
  }

  cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    const termsA = new Set(a.keys());
    const termsB = new Set(b.keys());
    const allTerms = new Set([...termsA, ...termsB]);

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const term of allTerms) {
      const va = a.get(term) ?? 0;
      const vb = b.get(term) ?? 0;
      dotProduct += va * vb;
      normA += va * va;
      normB += vb * vb;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  search(query: string, topK = 10): Array<{ docId: string; score: number }> {
    const queryVector = this.vectorizeQuery(query);
    if ([...queryVector.values()].every((v) => v === 0)) return [];

    const scores = this.tfidfVectors.map((docVec) => ({
      docId: docVec.docId,
      score: this.cosineSimilarity(queryVector, docVec.vector),
    }));

    return scores
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  getTFIDFVector(docId: string): TFIDFVector | undefined {
    return this.tfidfVectors.find((v) => v.docId === docId);
  }

  getVocabulary(): string[] {
    return [...this.vocabulary];
  }

  getIDF(term: string): number {
    return this.termIdf.get(term.toLowerCase()) ?? 0;
  }

  getDocumentCount(): number {
    return this.documents.length;
  }

  getTermDocumentMatrix(): { terms: string[]; docIds: string[]; matrix: number[][] } {
    const terms = this.vocabulary;
    const docIds = this.documents.map((d) => d.id);
    const matrix: number[][] = [];

    for (const term of terms) {
      const row: number[] = [];
      for (const doc of this.documents) {
        const vec = this.tfidfVectors.find((v) => v.docId === doc.id);
        row.push(vec?.vector.get(term) ?? 0);
      }
      matrix.push(row);
    }

    return { terms, docIds, matrix };
  }

  getTermFrequency(term: string, docId: string): number {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) return 0;
    const tokens = doc.text.toLowerCase().match(/\w+/g) ?? [];
    return tokens.filter((t) => t === term.toLowerCase()).length;
  }
}

export function buildVSMFromChunks(
  chunks: Array<{ id: string; text: string }>
): VectorSpaceModel {
  return new VectorSpaceModel(chunks);
}

export function compareDocumentVectors(
  vsm: VectorSpaceModel,
  docId1: string,
  docId2: string
): number {
  const v1 = vsm.getTFIDFVector(docId1);
  const v2 = vsm.getTFIDFVector(docId2);
  if (!v1 || !v2) return 0;
  return vsm.cosineSimilarity(v1.vector, v2.vector);
}

export function getTermSignificance(
  vsm: VectorSpaceModel,
  query: string,
  topN = 10
): Array<{ term: string; idf: number; queryTf: number }> {
  const queryVector = (vsm as any).vectorizeQuery(query);
  return [...queryVector.entries()]
    .map(([term, queryTf]) => ({
      term,
      idf: vsm.getIDF(term),
      queryTf,
    }))
    .sort((a, b) => b.idf * b.queryTf - a.idf * a.queryTf)
    .slice(0, topN);
}