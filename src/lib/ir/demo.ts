// Example usage of all 8 IR experiments.
// Run with: npx ts-node src/lib/ir/index.ts (or import in your app)

import {
  tokenize,
  preprocessDocument,
  stemWord,
  identifyNounGroups,
} from './preprocessing';
import {
  InvertedIndexBuilder,
  SuffixArray,
  buildInvertedIndexFromDocuments,
  searchInvertedIndex,
} from './indexing';
import { BooleanModel } from './boolean';
import { VectorSpaceModel } from './vsm';
import {
  exactMatch,
  prefixMatch,
  suffixMatch,
  substringMatch,
  kmpSearch,
  boyerMooreSearch,
  levenshteinDistance,
  fuzzyMatch,
  regexMatch,
  lexicalRangeSearch,
  multiPatternMatch,
} from './pattern-matching';
import {
  precisionAtK,
  recall,
  precision,
  f1Score,
  averagePrecision,
  meanAveragePrecision,
  evaluateRetrieval,
  evaluateMultiQuery,
  ndcgAtK,
} from './evaluation';
import {
  rocchioAlgorithm,
  ideRegular,
  ideDecHi,
} from './relevance-feedback';

// Sample documents
const documents = [
  { id: 'd1', text: 'Machine learning is a subset of artificial intelligence' },
  { id: 'd2', text: 'Deep learning uses neural networks for classification' },
  { id: 'd3', text: 'Natural language processing handles text and speech' },
  { id: 'd4', text: 'Computer vision processes images and video data' },
  { id: 'd5', text: 'Information retrieval systems help find relevant documents' },
  { id: 'd6', text: 'Artificial intelligence encompasses machine learning and robotics' },
  { id: 'd7', text: 'Neural networks are inspired by the human brain' },
  { id: 'd8', text: 'Text classification is a common NLP task' },
];

console.log('=== Experiment 7: Text Preprocessing ===');
const text = documents[0].text;
const tokens = tokenize(text);
console.log('Tokens:', tokens.map((t) => t.value));
const { filteredTokens, nounGroups, stemmedTerms } = preprocessDocument(text, {
  removeStopWords: true,
  stemWords: true,
  identifyNounGroups: true,
});
console.log('Filtered:', filteredTokens);
console.log('Noun groups:', nounGroups.map((g) => g.text));
console.log('Stemmed:', stemmedTerms.map((s) => `${s.original}→${s.stem}`));
console.log('Stem "learning":', stemWord('learning'));
console.log('Stem "classification":', stemWord('classification'));

console.log('\n=== Experiment 2: Inverted Index ===');
const index = buildInvertedIndexFromDocuments(documents);
console.log('Documents indexed:', index.getDocumentCount());
console.log('Terms:', index.getTerms().length);
console.log('Postings for "learning":', index.getPostings('learning').map((p) => p.docId));

console.log('\n=== Experiment 2: Suffix Array ===');
const sa = new SuffixArray();
sa.build('banana');
console.log('Search "ana" in "banana":', sa.search('ana'));
console.log('Prefix "ban":', sa.startWith('ban'));

console.log('\n=== Experiment 6: Boolean IR Model ===');
const booleanModel = BooleanModel.fromDocuments(documents);
console.log('Query "machine AND learning":', booleanModel.evaluate('machine AND learning'));
console.log('Query "learning OR vision":', booleanModel.evaluate('learning OR vision'));
console.log('Query "NOT vision":', booleanModel.evaluate('NOT vision'));
console.log('Query "(machine AND learning) OR vision":', booleanModel.evaluate('(machine AND learning) OR vision'));
const tdm = booleanModel.toTermDocumentMatrix();
console.log('Term-Document Matrix terms:', tdm.terms);
console.log('Term-Document Matrix docs:', tdm.docIds);
console.log('Matrix:');
tdm.terms.forEach((term, i) => {
  console.log(`  ${term}: ${tdm.matrix[i].map((v) => (v ? 1 : 0)).join(' ')}`);
});

console.log('\n=== Experiment 5: Vector Space Model ===');
const vsm = new VectorSpaceModel(documents);
const vsmResults = vsm.search('machine learning', 5);
console.log('VSM search "machine learning":', vsmResults);
console.log('VSM search "neural networks":', vsm.search('neural networks', 5));
console.log('Vocabulary:', vsm.getVocabulary().slice(0, 10));
console.log('IDF "learning":', vsm.getIDF('learning').toFixed(4));

console.log('\n=== Experiment 4: Pattern Matching ===');
console.log('Exact "learning":', exactMatch(documents, 'learning').matches.length, 'matches');
console.log('Prefix "learn":', prefixMatch(documents, 'learn').matches.length, 'matches');
console.log('Suffix "tion":', suffixMatch(documents, 'tion').matches.length, 'matches');
console.log('Substring "learn":', substringMatch(documents, 'learn').matches.length, 'matches');
console.log('KMP "learn" in docs[0]:', kmpSearch(documents[0].text, 'learn'));
console.log('BM "learn" in docs[0]:', boyerMooreSearch(documents[0].text, 'learn'));
console.log('Levenshtein "learn"/"earne":', levenshteinDistance('learn', 'earne'));
console.log('Fuzzy "machne" (maxDist 2):', fuzzyMatch(documents, 'machne', 2).matches.map((m) => ({ doc: m.docId, matched: m.matchedText, dist: m.distance })));
console.log('Regex "[a-z]+":', regexMatch(documents, /[a-z]+/g).matches.length, 'matches');
console.log('Lexical range "artificial..intelligence":', lexicalRangeSearch(documents, 'artificial', 'intelligence').matches.length, 'matches');

console.log('\n=== Experiment 3: Evaluation Metrics ===');
const relevant = new Set(['d1', 'd2', 'd6']);
const retrieved = ['d1', 'd2', 'd3', 'd4', 'd5'];
const metrics = evaluateRetrieval(relevant, retrieved, [1, 3, 5]);
console.log('Precision:', metrics.precision.toFixed(4));
console.log('Recall:', metrics.recall.toFixed(4));
console.log('F1:', metrics.f1Score.toFixed(4));
console.log('P@1:', metrics.precisionAtK[1].toFixed(4));
console.log('P@5:', metrics.precisionAtK[5].toFixed(4));
console.log('AP:', metrics.averagePrecision.toFixed(4));
console.log('NDCG@5:', metrics.ndcgAtK[5].toFixed(4));

const multiQuery = [
  { queryId: 'q1', relevantDocs: new Set(['d1', 'd2', 'd6']), retrievedDocs: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'] },
  { queryId: 'q2', relevantDocs: new Set(['d3', 'd8']), retrievedDocs: ['d3', 'd4', 'd8', 'd1'] },
];
const mapMetrics = evaluateMultiQuery(multiQuery, [5]);
console.log('MAP:', mapMetrics.meanAveragePrecision.toFixed(4));
console.log('Multi-query Precision:', mapMetrics.precision.toFixed(4));
console.log('Multi-query F1:', mapMetrics.f1Score.toFixed(4));

console.log('\n=== Experiment 1: Relevance Feedback ===');
const relevantVectors = [
  { docId: 'd1', vector: new Map([['machine', 1], ['learning', 1], ['artificial', 0.5]]) },
  { docId: 'd6', vector: new Map([['artificial', 1], ['intelligence', 1], ['machine', 0.8]]) },
];
const nonRelevantVectors = [
  { docId: 'd4', vector: new Map([['computer', 1], ['vision', 1], ['image', 0.8]]) },
  { docId: 'd5', vector: new Map([['information', 1], ['retrieval', 1], ['systems', 0.8]]) },
];

const rocchio = rocchioAlgorithm('machine learning', relevantVectors, nonRelevantVectors, 1, 0.75, 0.25, 10);
console.log('Rocchio query:', rocchio.reformulatedQuery);
console.log('Rocchio top terms:', rocchio.topTerms);

const ideReg = ideRegular('machine learning', relevantVectors, nonRelevantVectors, 0.75, 0.25, 10);
console.log('IDE Regular query:', ideReg.reformulatedQuery);

const ideDec = ideDecHi('machine learning', relevantVectors, nonRelevantVectors, 0.75, 0.25, 10);
console.log('IDE Dec-Hi query:', ideDec.reformulatedQuery);

console.log('\n=== All experiments executed successfully ===');
