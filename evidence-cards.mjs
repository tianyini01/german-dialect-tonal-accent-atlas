const make = (tag, className = "", content = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== "") node.textContent = content;
  return node;
};
const count = rows => new Set(rows.map(row => row.token)).size;
const median = values => {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const fmt = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });

export function evidenceForGroup(group, kind) {
  const rows = group.rows || [];
  const first = rows[0] || {};
  const tokens = new Map();
  rows.forEach(row => { if (!tokens.has(row.token)) tokens.set(row.token, row); });
  const durations = [...tokens.values()].map(row => kind === "f0" ? row.duration : row.value);
  const validF0 = kind === "f0" ? rows.filter(row => Number.isFinite(row.value)) : [];
  return {
    condition: group.condition || first.condition || "Unlabelled condition",
    word: group.word || [...new Set(rows.map(row => row.word).filter(Boolean))].join(" / ") || "Unlabelled word",
    pair: group.pair || first.pair || "",
    context: group.context || first.context || "",
    speaker: group.speaker || [...new Set(rows.map(row => row.speaker))].join(", "),
    tokenCount: tokens.size,
    f0ContourCount: count(validF0),
    f0PointCount: validF0.length,
    missingF0Count: kind === "f0" ? rows.length - validF0.length : null,
    durationCount: durations.filter(Number.isFinite).length,
    durationMedian: median(durations)
  };
}

export function renderEvidenceCard({ title, pair, speaker, context, kind, groups, source, note = "" }) {
  const card = make("section", "evidence-card");
  card.append(make("p", "eyebrow", "COMPARISON EVIDENCE"), make("h4", "", title));
  const facts = make("dl", "evidence-facts");
  for (const [label, value] of [["Full recorded pair", pair], ["Speaker / series", speaker],
    ["Single context", context], ["Measurement source", source]]) {
    facts.append(make("dt", "", label), make("dd", "", value || "Not recorded"));
  }
  card.append(facts);
  const table = make("table", "evidence-table");
  const head = make("thead");
  const heading = make("tr");
  ["Recorded condition · word", "Tokens", "Available cues"].forEach(label => heading.append(make("th", "", label)));
  head.append(heading);
  table.append(head);
  const body = make("tbody");
  groups.map(group => evidenceForGroup(group, kind)).forEach(item => {
    const row = make("tr");
    const cues = [`Duration ${item.durationCount ? `${item.durationCount} token${item.durationCount === 1 ? "" : "s"}; median ${fmt(item.durationMedian)} ms` : "unavailable"}`];
    cues.unshift(kind === "f0"
      ? `F0 ${item.f0ContourCount}/${item.tokenCount} contours; ${fmt(item.f0PointCount)} Hz points${item.missingF0Count ? `; ${fmt(item.missingF0Count)} gaps` : ""}`
      : "F0 unavailable in this source");
    row.append(make("th", "", `${item.condition} · ${item.word}`), make("td", "", fmt(item.tokenCount)),
      make("td", "", cues.join(" · ")));
    body.append(row);
  });
  table.append(body);
  card.append(table);
  if (note) card.append(make("p", "evidence-note", note));
  return card;
}
