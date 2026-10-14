/**
 * IR Search Model Evaluation Benchmark
 *
 * Tests all 6 search models against a corpus with ground-truth relevance
 * judgments, split into SEEN (development) and UNSEEN (held-out) query sets.
 *
 * Run:  npx tsx src/lib/ir/eval-benchmark.ts
 */

import type { SearchDocument, SearchMode } from './search';
import { searchDocuments } from './search';
import {
  precisionAtK,
  recall,
  f1Score,
  averagePrecision,
  ndcgAtK,
} from './evaluation';

// ─── Corpus ────────────────────────────────────────────────────────────
// 20 documents spanning CS / IR / ML / NLP / DB / Networks topics.
// Larger than the 8-doc demo so metrics are more meaningful.

const corpus: SearchDocument[] = [
  { id: 'd01', title: 'ML Basics', text: 'Machine learning is a subset of artificial intelligence that focuses on algorithms that learn from data' },
  { id: 'd02', title: 'Deep Learning', text: 'Deep learning uses multi-layered neural networks for representation learning and classification tasks' },
  { id: 'd03', title: 'NLP Foundations', text: 'Natural language processing handles text analysis speech recognition and language understanding' },
  { id: 'd04', title: 'Computer Vision', text: 'Computer vision processes images and video data using convolutional neural networks for object detection' },
  { id: 'd05', title: 'IR Systems', text: 'Information retrieval systems help find relevant documents using inverted indexes and ranking algorithms' },
  { id: 'd06', title: 'AI Overview', text: 'Artificial intelligence encompasses machine learning deep learning robotics and expert systems' },
  { id: 'd07', title: 'Neural Nets', text: 'Neural networks are computational models inspired by the human brain used for pattern recognition' },
  { id: 'd08', title: 'Text Classification', text: 'Text classification assigns predefined categories to documents using supervised machine learning methods' },
  { id: 'd09', title: 'Search Engines', text: 'Modern search engines combine text matching boolean retrieval and vector space models for ranking web pages' },
  { id: 'd10', title: 'Recommender Systems', text: 'Recommender systems use collaborative filtering and content based methods to suggest relevant items to users' },
  { id: 'd11', title: 'Database Indexing', text: 'Database indexing structures like B-trees and hash indexes accelerate query processing in relational databases' },
  { id: 'd12', title: 'Data Mining', text: 'Data mining discovers patterns in large datasets using clustering classification and association rule algorithms' },
  { id: 'd13', title: 'Reinforcement Learning', text: 'Reinforcement learning trains agents to make decisions through reward signals in sequential environments' },
  { id: 'd14', title: 'Transfer Learning', text: 'Transfer learning leverages pre-trained models to improve performance on new tasks with limited labeled data' },
  { id: 'd15', title: 'Word Embeddings', text: 'Word embeddings represent words as dense vectors capturing semantic similarity and linguistic relationships' },
  { id: 'd16', title: 'Transformers', text: 'Transformer models use self-attention mechanisms and are the basis for modern language models like BERT and GPT' },
  { id: 'd17', title: 'Clustering', text: 'Clustering algorithms group similar data points together using distance metrics like k-means and hierarchical methods' },
  { id: 'd18', title: 'Network Security', text: 'Network security protects computer networks from intrusion using firewalls encryption and access control' },
  { id: 'd19', title: 'Parallel Computing', text: 'Parallel computing distributes computational tasks across multiple processors for faster execution of algorithms' },
  { id: 'd20', title: 'Knowledge Graphs', text: 'Knowledge graphs represent structured information as entities and relationships enabling semantic search and reasoning' },
];

// ─── Ground-truth relevance judgments ──────────────────────────────────
// Each query maps to the set of document IDs that are truly relevant.

interface QueryJudgment {
  query: string;
  /** For Boolean mode — same intent but expressed with AND/OR operators */
  booleanQuery: string;
  relevant: Set<string>;
}

// SEEN queries — model "knew" about these during conceptual design
const seenQueries: QueryJudgment[] = [
  {
    query: 'machine learning',
    booleanQuery: 'machine AND learning',
    relevant: new Set(['d01', 'd06', 'd08', 'd14']),
  },
  {
    query: 'neural networks',
    booleanQuery: 'neural AND networks',
    relevant: new Set(['d02', 'd04', 'd07']),
  },
  {
    query: 'text classification',
    booleanQuery: 'text AND classification',
    relevant: new Set(['d03', 'd08', 'd09']),
  },
  {
    query: 'information retrieval',
    booleanQuery: 'information AND retrieval',
    relevant: new Set(['d05', 'd09', 'd20']),
  },
  {
    query: 'deep learning algorithms',
    booleanQuery: 'deep AND learning',
    relevant: new Set(['d02', 'd06', 'd16']),
  },
];

// UNSEEN queries — held-out, never seen during design, includes typos
const unseenQueries: QueryJudgment[] = [
  {
    query: 'data clustering',
    booleanQuery: 'data AND clustering',
    relevant: new Set(['d12', 'd17']),
  },
  {
    query: 'search ranking',
    booleanQuery: 'search AND ranking',
    relevant: new Set(['d05', 'd09', 'd20']),
  },
  {
    query: 'language models transformers',
    booleanQuery: 'language AND models',
    relevant: new Set(['d03', 'd15', 'd16']),
  },
  {
    query: 'reinforcment learnig',  // intentional typos
    booleanQuery: 'reinforcement AND learning',
    relevant: new Set(['d13']),
  },
  {
    query: 'image recognition vision',
    booleanQuery: 'vision AND recognition',
    relevant: new Set(['d04', 'd07']),
  },
  {
    query: 'semantic similarity',  // typo: semantic → semantic
    booleanQuery: 'semantic AND similarity',
    relevant: new Set(['d15', 'd20']),
  },
  {
    query: 'supervised learning classification',
    booleanQuery: 'learning AND classification',
    relevant: new Set(['d01', 'd08', 'd12', 'd14']),
  },
];

// ─── Metric aggregation ───────────────────────────────────────────────

interface MetricSet {
  'P@5': number;
  'P@10': number;
  Recall: number;
  F1: number;
  AP: number;
  'NDCG@5': number;
  'NDCG@10': number;
}

const MODES: SearchMode[] = ['exact', 'prefix', 'fuzzy', 'boolean', 'vsm', 'hybrid'];

function evaluateMode(
  mode: SearchMode,
  queries: QueryJudgment[],
): MetricSet {
  const perQuery: MetricSet[] = [];

  for (const qj of queries) {
    const q = mode === 'boolean' ? qj.booleanQuery : qj.query;
    const results = searchDocuments(corpus, q, mode);
    const retrieved = results.map((r) => r.docId);
    const rel = qj.relevant;

    perQuery.push({
      'P@5': precisionAtK(rel, retrieved, 5),
      'P@10': precisionAtK(rel, retrieved, 10),
      Recall: recall(rel, retrieved),
      F1: f1Score(rel, retrieved),
      AP: averagePrecision(rel, retrieved),
      'NDCG@5': ndcgAtK(rel, retrieved, 5),
      'NDCG@10': ndcgAtK(rel, retrieved, 10),
    });
  }

  // Macro-average across queries
  const avg: MetricSet = { 'P@5': 0, 'P@10': 0, Recall: 0, F1: 0, AP: 0, 'NDCG@5': 0, 'NDCG@10': 0 };
  for (const m of perQuery) {
    for (const key of Object.keys(avg) as (keyof MetricSet)[]) {
      avg[key] += m[key];
    }
  }
  const n = perQuery.length;
  for (const key of Object.keys(avg) as (keyof MetricSet)[]) {
    avg[key] = +(avg[key] / n).toFixed(4);
  }
  return avg;
}

// ─── Run evaluation ───────────────────────────────────────────────────

function printTable(title: string, queries: QueryJudgment[]) {
  console.log(`\n${'═'.repeat(90)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(90)}`);

  const header = ['Model', 'P@5', 'P@10', 'Recall', 'F1', 'AP', 'NDCG@5', 'NDCG@10'];
  const colW = [10, 8, 8, 8, 8, 8, 8, 8];

  console.log(header.map((h, i) => h.padEnd(colW[i])).join(' │ '));
  console.log(colW.map((w) => '─'.repeat(w)).join('─┼─'));

  const rows: { mode: string; metrics: MetricSet }[] = [];

  for (const mode of MODES) {
    const metrics = evaluateMode(mode, queries);
    rows.push({ mode, metrics });
    const vals = [
      mode.padEnd(colW[0]),
      metrics['P@5'].toFixed(4).padStart(colW[1]),
      metrics['P@10'].toFixed(4).padStart(colW[2]),
      metrics.Recall.toFixed(4).padStart(colW[3]),
      metrics.F1.toFixed(4).padStart(colW[4]),
      metrics.AP.toFixed(4).padStart(colW[5]),
      metrics['NDCG@5'].toFixed(4).padStart(colW[6]),
      metrics['NDCG@10'].toFixed(4).padStart(colW[7]),
    ];
    console.log(vals.join(' │ '));
  }

  // Find best per column
  console.log(colW.map((w) => '─'.repeat(w)).join('─┼─'));
  const bestRow = ['★ Best'.padEnd(colW[0])];
  for (const key of ['P@5', 'P@10', 'Recall', 'F1', 'AP', 'NDCG@5', 'NDCG@10'] as (keyof MetricSet)[]) {
    let bestVal = -1;
    let bestMode = '';
    for (const r of rows) {
      if (r.metrics[key] > bestVal) {
        bestVal = r.metrics[key];
        bestMode = r.mode;
      }
    }
    bestRow.push(bestMode.padStart(colW[bestRow.length - 1]));
  }
  console.log(bestRow.join(' │ '));
}

// ─── Per-query detail view ────────────────────────────────────────────

function printPerQueryDetail(title: string, queries: QueryJudgment[]) {
  console.log(`\n${'─'.repeat(90)}`);
  console.log(`  ${title} — Per-Query Breakdown`);
  console.log(`${'─'.repeat(90)}`);

  for (const qj of queries) {
    console.log(`\n  Query: "${qj.query}" | Relevant: [${[...qj.relevant].join(', ')}]`);
    for (const mode of MODES) {
      const q = mode === 'boolean' ? qj.booleanQuery : qj.query;
      const results = searchDocuments(corpus, q, mode);
      const retrieved = results.map((r) => r.docId);
      const rel = qj.relevant;
      const p5 = precisionAtK(rel, retrieved, 5).toFixed(3);
      const rec = recall(rel, retrieved).toFixed(3);
      const f1 = f1Score(rel, retrieved).toFixed(3);
      const ap = averagePrecision(rel, retrieved).toFixed(3);
      const ndcg5 = ndcgAtK(rel, retrieved, 5).toFixed(3);
      const hits = retrieved.filter((d) => rel.has(d)).length;
      console.log(
        `    ${mode.padEnd(8)} → retrieved ${retrieved.length.toString().padStart(2)} docs, ` +
        `${hits}/${rel.size} relevant | P@5=${p5} R=${rec} F1=${f1} AP=${ap} NDCG@5=${ndcg5}`
      );
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║   IR Search Model Evaluation — Nudge Corpus (20 documents)     ║');
console.log('║   Models: Exact, Prefix, Fuzzy, Boolean, VSM, Hybrid           ║');
console.log('║   Queries: 5 seen + 7 unseen (incl. typos)                     ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

printTable('SEEN Queries (5 queries — used during development)', seenQueries);
printTable('UNSEEN Queries (7 queries — held-out, includes typos)', unseenQueries);
printTable('ALL Queries (12 queries — combined)', [...seenQueries, ...unseenQueries]);

printPerQueryDetail('SEEN', seenQueries);
printPerQueryDetail('UNSEEN', unseenQueries);

console.log('\n✅ Evaluation complete.\n');
