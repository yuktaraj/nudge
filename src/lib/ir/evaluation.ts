import type { EvaluationMetrics, RelevanceJudgment } from './types';

export function precisionAtK(
  relevantDocs: Set<string>,
  retrievedDocs: string[],
  k: number
): number {
  const topK = retrievedDocs.slice(0, k);
  if (topK.length === 0) return 0;
  const relevantInTopK = topK.filter((doc) => relevantDocs.has(doc)).length;
  return relevantInTopK / k;
}

export function recall(
  relevantDocs: Set<string>,
  retrievedDocs: string[]
): number {
  if (relevantDocs.size === 0) return 0;
  const relevantRetrieved = retrievedDocs.filter((doc) => relevantDocs.has(doc)).length;
  return relevantRetrieved / relevantDocs.size;
}

export function precision(
  relevantDocs: Set<string>,
  retrievedDocs: string[]
): number {
  if (retrievedDocs.length === 0) return 0;
  const relevantRetrieved = retrievedDocs.filter((doc) => relevantDocs.has(doc)).length;
  return relevantRetrieved / retrievedDocs.length;
}

export function f1Score(
  relevantDocs: Set<string>,
  retrievedDocs: string[]
): number {
  const p = precision(relevantDocs, retrievedDocs);
  const r = recall(relevantDocs, retrievedDocs);
  if (p + r === 0) return 0;
  return (2 * p * r) / (p + r);
}

export function averagePrecision(
  relevantDocs: Set<string>,
  retrievedDocs: string[]
): number {
  if (relevantDocs.size === 0) return 0;

  let sum = 0;
  let hits = 0;

  for (let i = 0; i < retrievedDocs.length; i++) {
    if (relevantDocs.has(retrievedDocs[i])) {
      hits++;
      sum += hits / (i + 1);
    }
  }

  return sum / relevantDocs.size;
}

export function meanAveragePrecision(
  queriesRelevance: Array<{
    relevantDocs: Set<string>;
    retrievedDocs: string[];
  }>
): number {
  if (queriesRelevance.length === 0) return 0;
  const aps = queriesRelevance.map((qr) =>
    averagePrecision(qr.relevantDocs, qr.retrievedDocs)
  );
  return aps.reduce((sum, ap) => sum + ap, 0) / aps.length;
}

function dcgAtK(scores: number[], k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(scores.length, k); i++) {
    dcg += scores[i] / Math.log2(i + 2);
  }
  return dcg;
}

export function ndcgAtK(
  relevantDocs: Set<string>,
  retrievedDocs: string[],
  k: number,
  graded: boolean = false
): number {
  const scores = retrievedDocs.map((doc) => {
    if (!graded) {
      return relevantDocs.has(doc) ? 1 : 0;
    }
    return relevantDocs.has(doc) ? 2 : relevantDocs.has(doc) ? 1 : 0;
  });

  const idealScores = Array.from(relevantDocs)
    .map(() => 1)
    .sort((a, b) => b - a);
  while (idealScores.length < k) idealScores.push(0);

  const dcg = dcgAtK(scores, k);
  const idcg = dcgAtK(idealScores.slice(0, k), k);

  if (idcg === 0) return 0;
  return dcg / idcg;
}

export function evaluateRetrieval(
  relevantDocs: Set<string>,
  retrievedDocs: string[],
  kValues: number[] = [1, 5, 10]
): EvaluationMetrics {
  const precisionAtKRecord: Record<number, number> = {};
  const ndcgAtKRecord: Record<number, number> = {};

  for (const k of kValues) {
    precisionAtKRecord[k] = precisionAtK(relevantDocs, retrievedDocs, k);
    ndcgAtKRecord[k] = ndcgAtK(relevantDocs, retrievedDocs, k);
  }

  const p = precision(relevantDocs, retrievedDocs);
  const r = recall(relevantDocs, retrievedDocs);

  return {
    precision: p,
    recall: r,
    f1Score: f1Score(relevantDocs, retrievedDocs),
    precisionAtK: precisionAtKRecord,
    averagePrecision: averagePrecision(relevantDocs, retrievedDocs),
    meanAveragePrecision: 0,
    ndcgAtK: ndcgAtKRecord,
  };
}

export function evaluateMultiQuery(
  queries: Array<{
    queryId: string;
    relevantDocs: Set<string>;
    retrievedDocs: string[];
  }>,
  kValues: number[] = [1, 5, 10]
): EvaluationMetrics {
  if (queries.length === 0) {
    return {
      precision: 0,
      recall: 0,
      f1Score: 0,
      precisionAtK: {},
      averagePrecision: 0,
      meanAveragePrecision: 0,
      ndcgAtK: {},
    };
  }

  const precisionAtKRecord: Record<number, number> = {};
  const ndcgAtKRecord: Record<number, number> = {};

  for (const k of kValues) {
    const pAtK = queries.map((q) => precisionAtK(q.relevantDocs, q.retrievedDocs, k));
    precisionAtKRecord[k] = pAtK.reduce((sum, v) => sum + v, 0) / pAtK.length;

    const ndcg = queries.map((q) => ndcgAtK(q.relevantDocs, q.retrievedDocs, k));
    ndcgAtKRecord[k] = ndcg.reduce((sum, v) => sum + v, 0) / ndcg.length;
  }

  const avgPrecision = queries.map((q) =>
    averagePrecision(q.relevantDocs, q.retrievedDocs)
  );
  const mapValue = avgPrecision.reduce((sum, v) => sum + v, 0) / avgPrecision.length;

  const precisions = queries.map((q) => precision(q.relevantDocs, q.retrievedDocs));
  const recalls = queries.map((q) => recall(q.relevantDocs, q.retrievedDocs));
  const avgP = precisions.reduce((sum, v) => sum + v, 0) / precisions.length;
  const avgR = recalls.reduce((sum, v) => sum + v, 0) / recalls.length;

  return {
    precision: avgP,
    recall: avgR,
    f1Score: avgP + avgR > 0 ? (2 * avgP * avgR) / (avgP + avgR) : 0,
    precisionAtK: precisionAtKRecord,
    averagePrecision: mapValue,
    meanAveragePrecision: mapValue,
    ndcgAtK: ndcgAtKRecord,
  };
}

export function confusionMatrix(
  relevantDocs: Set<string>,
  retrievedDocs: string[],
  allDocIds: string[]
): { tp: number; fp: number; tn: number; fn: number } {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const retrievedSet = new Set(retrievedDocs);

  for (const docId of allDocIds) {
    const isRelevant = relevantDocs.has(docId);
    const isRetrieved = retrievedSet.has(docId);
    if (isRelevant && isRetrieved) tp++;
    else if (!isRelevant && isRetrieved) fp++;
    else if (!isRelevant && !isRetrieved) tn++;
    else fn++;
  }

  return { tp, fp, tn, fn };
}

export function rocCurveData(
  relevantDocs: Set<string>,
  rankedDocs: string[]
): Array<{ fpr: number; tpr: number }> {
  const totalRelevant = relevantDocs.size;
  const totalNonRelevant = rankedDocs.length - totalRelevant;
  let tp = 0, fp = 0;
  const points: Array<{ fpr: number; tpr: number }> = [{ fpr: 0, tpr: 0 }];

  for (const docId of rankedDocs) {
    if (relevantDocs.has(docId)) tp++; else fp++;
    points.push({
      fpr: totalNonRelevant > 0 ? fp / totalNonRelevant : 0,
      tpr: totalRelevant > 0 ? tp / totalRelevant : 0,
    });
  }

  return points;
}

export function judgmentToRelevanceSet(
  judgments: RelevanceJudgment[],
  threshold = 1
): { relevant: Set<string>; retrieved: string[] } {
  const relevant = new Set<string>();
  const docToRank = new Map<string, number>();

  for (const j of judgments) {
    if (j.relevanceGrade >= threshold) relevant.add(j.docId);
    if (!docToRank.has(j.docId) || j.rank < docToRank.get(j.docId)!) {
      docToRank.set(j.docId, j.rank);
    }
  }

  const retrieved = [...docToRank.entries()]
    .sort((a, b) => a[1] - b[1])
    .map((e) => e[0]);

  return { relevant, retrieved };
}