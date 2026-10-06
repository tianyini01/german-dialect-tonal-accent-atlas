const key = (...values) => JSON.stringify(values);
const sortLabels = labels => [...labels].sort((a, b) => a.localeCompare(b));

export function comparisonConditions(rows) {
  const recorded = new Set(rows.map(row => row.condition));
  if (recorded.has("Long") && recorded.has("Overlong")) return ["Long", "Overlong"];
  if (recorded.has("Accent1") && recorded.has("Accent2")) return ["Accent1", "Accent2"];
  return recorded.size === 2 ? sortLabels(recorded) : [];
}

function requiredConditions(rows, conditions) {
  const labels = conditions || comparisonConditions(rows);
  if (labels.length !== 2 || labels[0] === labels[1]) {
    throw new Error("This measurement needs two recorded conditions for a within-pair comparison.");
  }
  return labels;
}

// A complete cell contains both measured lexical items from one speaker, pair and context.
function completeCells(rows, conditions) {
  const indexed = new Map();
  for (const row of rows) {
    if (!conditions.includes(row.condition)) continue;
    const id = key(row.speaker, row.pair, row.context);
    if (!indexed.has(id)) indexed.set(id, { speaker: row.speaker, pair: row.pair,
      context: row.context, byCondition: new Map() });
    const cell = indexed.get(id);
    if (!cell.byCondition.has(row.condition)) cell.byCondition.set(row.condition, new Map());
    const words = cell.byCondition.get(row.condition);
    if (!words.has(row.word)) words.set(row.word, false);
    if (Number.isFinite(row.value)) words.set(row.word, true);
  }
  const cells = [];
  for (const cell of indexed.values()) {
    const [first, second] = conditions.map(condition => cell.byCondition.get(condition));
    if (first?.size !== 1 || second?.size !== 1) continue;
    const [wordA, measuredA] = [...first][0], [wordB, measuredB] = [...second][0];
    if (!measuredA || !measuredB || wordA === wordB) continue;
    cells.push({ speaker: cell.speaker, pair: cell.pair, context: cell.context,
      words: [wordA, wordB] });
  }
  return cells;
}

function groupRows(rows, cells, condition, word) {
  const eligible = new Set(cells.map(cell => key(cell.speaker, cell.pair, cell.context)));
  return rows.filter(row => row.condition === condition && row.word === word
    && eligible.has(key(row.speaker, row.pair, row.context)));
}

function sameWords(cellA, cellB) {
  return cellA.words[0] === cellB.words[0] && cellA.words[1] === cellB.words[1];
}

export function sharedSpeakerPairs(rows, { speakerA, speakerB, context = "", conditions } = {}) {
  if (!speakerA || !speakerB || speakerA === speakerB) return [];
  const labels = requiredConditions(rows, conditions);
  const cells = completeCells(rows, labels).filter(cell => !context || cell.context === context);
  const a = cells.filter(cell => cell.speaker === speakerA);
  const b = cells.filter(cell => cell.speaker === speakerB);
  return sortLabels(new Set(a.filter(cellA => b.some(cellB => cellA.pair === cellB.pair
    && cellA.context === cellB.context && sameWords(cellA, cellB))).map(cell => cell.pair)));
}

export function matchedSpeakerGroups(rows, intensityRows, {
  speakerA, speakerB, pair, context, conditions
}) {
  if (!speakerA || !speakerB || speakerA === speakerB) throw new Error("Choose two different speakers.");
  if (!pair) throw new Error("Choose one complete word pair shared by both speakers.");
  if (!context) throw new Error("Choose one context for both speakers.");
  const labels = requiredConditions(rows, conditions);
  const cells = completeCells(rows, labels).filter(cell => cell.pair === pair && cell.context === context);
  const cellA = cells.find(cell => cell.speaker === speakerA);
  const cellB = cells.find(cell => cell.speaker === speakerB);
  if (!cellA || !cellB || !sameWords(cellA, cellB)) {
    throw new Error(`Both speakers need both ${labels.join(" and ")} lexical items from the same pair and context.`);
  }
  const groups = [cellA, cellB].flatMap((cell, comparisonIndex) => labels.map((condition, conditionIndex) => {
    const word = cell.words[conditionIndex];
    const selected = [cell];
    return { label: `Speaker ${cell.speaker} · ${condition}: ${word}`,
      speaker: cell.speaker, pair, context, condition, word, comparisonIndex,
      rows: groupRows(rows, selected, condition, word),
      intensityRows: groupRows(intensityRows || [], selected, condition, word) };
  }));
  return { groups, pair, context, conditions: labels, words: cellA.words, cellCount: 1 };
}

export function comparablePairNames(rows, { context = "", conditions } = {}) {
  const labels = requiredConditions(rows, conditions);
  return sortLabels(new Set(completeCells(rows, labels)
    .filter(cell => !context || cell.context === context).map(cell => cell.pair)));
}

export function sharedPairNames(rows, { pair, context = "", conditions } = {}) {
  if (!pair) return [];
  const labels = requiredConditions(rows, conditions);
  const cells = completeCells(rows, labels).filter(cell => !context || cell.context === context);
  const anchor = new Set(cells.filter(cell => cell.pair === pair)
    .map(cell => key(cell.speaker, cell.context)));
  return sortLabels(new Set(cells.filter(cell => cell.pair !== pair
    && anchor.has(key(cell.speaker, cell.context))).map(cell => cell.pair)));
}

export function matchedPairGroups(rows, intensityRows, { pairA, pairB, context = "", conditions }) {
  if (!pairA || !pairB || pairA === pairB) throw new Error("Choose two different word pairs.");
  const labels = requiredConditions(rows, conditions);
  const cells = completeCells(rows, labels).filter(cell => !context || cell.context === context);
  const common = new Set(cells.filter(cell => cell.pair === pairA)
    .map(cell => key(cell.speaker, cell.context)));
  const pairBCells = cells.filter(cell => cell.pair === pairB
    && common.has(key(cell.speaker, cell.context)));
  const matched = new Set(pairBCells.map(cell => key(cell.speaker, cell.context)));
  const pairCells = [pairA, pairB].map(pair => cells.filter(cell => cell.pair === pair
    && matched.has(key(cell.speaker, cell.context))));
  if (pairCells.some(selected => !selected.length)) {
    throw new Error(`Both selected pairs need measured ${labels.join(" and ")} lexical items for the same speakers and contexts.`);
  }
  const groups = pairCells.flatMap((selected, comparisonIndex) => labels.map((condition, conditionIndex) => {
    const words = sortLabels(new Set(selected.map(cell => cell.words[conditionIndex])));
    if (words.length !== 1) {
      throw new Error(`Pair ${[pairA, pairB][comparisonIndex]} has inconsistent lexical items for ${condition}.`);
    }
    const word = words[0];
    const pair = [pairA, pairB][comparisonIndex];
    return { label: `${pair} · ${condition}: ${word}`,
      pair, condition, word, comparisonIndex,
      rows: groupRows(rows, selected, condition, word),
      intensityRows: groupRows(intensityRows || [], selected, condition, word) };
  }));
  return { groups, pairs: [pairA, pairB], context, conditions: labels,
    contexts: sortLabels(new Set(pairCells.flat().map(cell => cell.context))),
    cellCount: matched.size };
}
