export {
  tokenize,
  preprocessDocument,
  ENGLISH_STOP_WORDS,
  stemWord,
  identifyNounGroups,
} from './preprocessing';

export {
  InvertedIndexBuilder,
  SuffixArray,
  SuffixTree,
  buildInvertedIndexFromDocuments,
  searchInvertedIndex,
} from './indexing';

export { BooleanModel } from './boolean';

export {
  VectorSpaceModel,
  buildVSMFromChunks,
  compareDocumentVectors,
  getTermSignificance,
} from './vsm';

export {
  exactMatch,
  prefixMatch,
  suffixMatch,
  substringMatch,
  kmpSearch,
  boyerMooreSearch,
  suffixArraySearch,
  lexicalRangeSearch,
  levenshteinDistance,
  fuzzyMatch,
  regexMatch,
  wildcardMatch,
  multiPatternMatch,
} from './pattern-matching';

export {
  precisionAtK,
  recall,
  precision,
  f1Score,
  averagePrecision,
  meanAveragePrecision,
  evaluateRetrieval,
  evaluateMultiQuery,
  confusionMatrix,
  rocCurveData,
  judgmentToRelevanceSet,
  ndcgAtK,
} from './evaluation';

export {
  rocchioAlgorithm,
  ideRegular,
  ideDecHi,
  relevanceFeedbackQueryExpansion,
  applyRelevanceFeedback,
} from './relevance-feedback';

export {
  useDocumentSearch,
  searchDocuments,
  buildReformulatedQuery,
  type SearchMode,
  type FeedbackModel,
  type SearchDocument,
  type RankedSearchResult,
  type SearchFeedback,
  type SearchHookResult,
} from './search';
