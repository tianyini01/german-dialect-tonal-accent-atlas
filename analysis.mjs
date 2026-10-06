const MAX_ROWS = 100000;

export function parseCsv(source) {
  const text = source.replace(/^\uFEFF/, "");
  const lines = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      if (cell.length) throw new Error("Malformed CSV quoting.");
      quoted = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some(value => value.trim() !== "")) lines.push(row);
      row = [];
      if (lines.length > MAX_ROWS + 1) throw new Error(`CSV exceeds ${MAX_ROWS.toLocaleString()} data rows.`);
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  row.push(cell);
  if (row.some(value => value.trim() !== "")) lines.push(row);
  if (lines.length < 2) throw new Error("CSV needs a header and at least one data row.");
  const headers = lines.shift().map(value => value.trim());
  if (headers.some(value => !value) || new Set(headers).size !== headers.length) throw new Error("CSV headers must be nonempty and unique.");
  const records = lines.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} fields; expected ${headers.length}.`);
    const record = Object.create(null);
    headers.forEach((header, position) => { record[header] = values[position].trim(); });
    return record;
  });
  return { headers, records };
}

const hasAll = (headers, names) => names.every(name => headers.includes(name));
const first = (record, names) => names.map(name => record[name]).find(value => value !== undefined) ?? "";
const number = (value, label, rowNumber) => {
  const parsed = Number(value);
  if (value === "" || !Number.isFinite(parsed)) throw new Error(`Row ${rowNumber}: ${label} must be a finite number.`);
  return parsed;
};
const required = (value, label, rowNumber) => {
  if (!String(value).trim()) throw new Error(`Row ${rowNumber}: ${label} is required.`);
  return String(value).trim();
};

export function detectKind(headers) {
  if (headers.includes("duration_ms") || headers.includes("Duration_ms")) return "duration";
  if (headers.includes("f0_st") || headers.includes("F0_ST_re100") || headers.includes("f0_hz") || headers.includes("f0_Hz")) return "f0";
  throw new Error("Unrecognized measurement columns. Use a blank template from the data guide.");
}

export function normalizeCsv(parsed) {
  const { headers, records } = parsed;
  const kind = detectKind(headers);
  let profile;
  if (kind === "duration") {
    if (hasAll(headers, ["speaker_id", "pair_id", "context_id", "condition", "token_id", "duration_ms"])) profile = "standard";
    else if (hasAll(headers, ["Speaker_ID", "Word_Pair", "Prosodic_Environment", "Quantity", "Source_TextGrid", "Duration_ms"])) profile = "Leer duration";
    else throw new Error("Duration CSV is missing required columns. See the template and native Leer profile in the data guide.");
    const seen = new Set();
    const rows = records.map((record, i) => {
      const n = i + 2;
      const row = profile === "standard" ? {
        speaker: required(record.speaker_id, "speaker_id", n), pair: required(record.pair_id, "pair_id", n),
        context: required(record.context_id, "context_id", n), condition: required(record.condition, "condition", n),
        token: required(record.token_id, "token_id", n), value: number(record.duration_ms, "duration_ms", n),
        word: (record.word || record.pair_id).trim()
      } : {
        speaker: required(record.Speaker_ID, "Speaker_ID", n), pair: required(record.Word_Pair, "Word_Pair", n),
        context: required(record.Prosodic_Environment, "Prosodic_Environment", n), condition: required(record.Quantity, "Quantity", n),
        token: required(record.Source_TextGrid, "Source_TextGrid", n), value: number(record.Duration_ms, "Duration_ms", n),
        word: (record.word || record.Word_Pair).trim()
      };
      if (row.value <= 0) throw new Error(`Row ${n}: duration must be greater than zero.`);
      if (seen.has(row.token)) throw new Error(`Row ${n}: token_id repeats. Each duration token needs a unique ID.`);
      seen.add(row.token);
      return row;
    });
    return { kind, profile, rows, skipped: 0, reference: "milliseconds" };
  }

  if (hasAll(headers, ["speaker_id", "pair_id", "context_id", "condition", "token_id", "time_norm", "f0_hz", "speaker_ref_hz"])) profile = "standard Hz";
  else if (hasAll(headers, ["speaker_id", "pair_id", "context_id", "condition", "token_id", "time_norm", "f0_st"])) profile = "standard ST";
  else if (hasAll(headers, ["Speaker", "WordPair", "Environment", "Length", "Token", "time_norm", "F0_ST_re100"])) profile = "Leer F0";
  else if (hasAll(headers, ["speaker", "word_pair", "context", "accent", "TokenID", "time_norm", "f0_st"])) profile = "Aachen F0";
  else throw new Error("F0 CSV is missing required columns. See the template and native profiles in the data guide.");

  const seen = new Set();
  const tokenAttributes = new Map();
  const speakerReferences = new Map();
  let skipped = 0;
  const rows = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const n = i + 2;
    const raw = profile === "Leer F0" ? {
      speaker: record.Speaker, pair: record.WordPair, context: record.Environment, condition: record.Length, token: record.Token,
      time: record.time_norm, value: record.F0_ST_re100
    } : profile === "Aachen F0" ? {
      speaker: record.speaker, pair: record.word_pair, context: record.context, condition: record.accent, token: record.TokenID,
      time: record.time_norm, value: record.f0_st
    } : {
      speaker: record.speaker_id, pair: record.pair_id, context: record.context_id, condition: record.condition, token: record.token_id,
      time: record.time_norm, value: profile === "standard Hz" ? record.f0_hz : record.f0_st
    };
    const row = {
      speaker: required(raw.speaker, "speaker", n), pair: required(raw.pair, "pair", n),
      context: required(raw.context, "context", n), condition: required(raw.condition, "condition", n),
      token: required(raw.token, "token", n), time: number(raw.time, "time_norm", n)
    };
    if (row.time < 0 || row.time > 1) throw new Error(`Row ${n}: time_norm must be between 0 and 1.`);
    row.time = Number(row.time.toFixed(6));
    const attributes = JSON.stringify([row.speaker, row.pair, row.context, row.condition]);
    if (tokenAttributes.has(row.token) && tokenAttributes.get(row.token) !== attributes) throw new Error(`Row ${n}: a token ID changes speaker, pair, context, or condition.`);
    tokenAttributes.set(row.token, attributes);
    const unique = JSON.stringify([row.token, row.time]);
    if (seen.has(unique)) throw new Error(`Row ${n}: duplicate time point for the same token.`);
    seen.add(unique);
    if (profile === "standard Hz") {
      const ref = number(record.speaker_ref_hz, "speaker_ref_hz", n);
      if (ref <= 0) throw new Error(`Row ${n}: speaker_ref_hz must be greater than zero.`);
      if (speakerReferences.has(row.speaker) && speakerReferences.get(row.speaker) !== ref) throw new Error(`Row ${n}: speaker_ref_hz changes within a speaker.`);
      speakerReferences.set(row.speaker, ref);
      if (raw.value === "" || Number(raw.value) === 0) { skipped += 1; continue; }
      const hz = number(raw.value, "f0_hz", n);
      if (hz < 0) throw new Error(`Row ${n}: f0_hz cannot be negative.`);
      row.value = 12 * Math.log2(hz / ref);
    } else {
      if (raw.value === "") { skipped += 1; continue; }
      row.value = number(raw.value, "F0 semitones", n);
    }
    rows.push(row);
  }
  if (!rows.length) throw new Error("No voiced F0 measurements remain after missing values are skipped.");
  const reference = profile === "Leer F0" ? "ST relative to 100 Hz" : profile === "Aachen F0" ? "speaker-centered ST" : profile === "standard Hz" ? "ST relative to supplied speaker reference" : "ST (reference defined by your input)";
  return { kind, profile, rows, skipped, reference };
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const key = (...values) => JSON.stringify(values);
export const levels = (rows, field) => [...new Set(rows.map(row => row[field]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

export function summarizeDuration(rows, { conditionA, conditionB, pair = "", context = "" }) {
  if (!conditionA || !conditionB || conditionA === conditionB) throw new Error("Choose two different conditions.");
  const filtered = rows.filter(row => (!pair || row.pair === pair) && (!context || row.context === context) && [conditionA, conditionB].includes(row.condition));
  const cells = new Map();
  filtered.forEach(row => {
    const id = key(row.speaker, row.pair, row.context);
    if (!cells.has(id)) cells.set(id, { speaker: row.speaker, pair: row.pair, context: row.context, groups: new Map() });
    const cell = cells.get(id);
    if (!cell.groups.has(row.condition)) cell.groups.set(row.condition, []);
    cell.groups.get(row.condition).push(Math.log(row.value));
  });
  const matched = [];
  let unmatched = 0;
  cells.forEach(cell => {
    if (!cell.groups.has(conditionA) || !cell.groups.has(conditionB)) { unmatched += 1; return; }
    matched.push({ speaker: cell.speaker, pair: cell.pair, context: cell.context,
      logRatio: mean(cell.groups.get(conditionB)) - mean(cell.groups.get(conditionA)),
      tokens: cell.groups.get(conditionA).length + cell.groups.get(conditionB).length });
  });
  if (!matched.length) throw new Error("No matched speaker × pair × context cells have both selected conditions.");
  const bySpeaker = new Map();
  matched.forEach(cell => { if (!bySpeaker.has(cell.speaker)) bySpeaker.set(cell.speaker, []); bySpeaker.get(cell.speaker).push(cell.logRatio); });
  const speakers = [...bySpeaker].map(([speaker, values]) => ({ speaker, ratio: Math.exp(mean(values)), cells: values.length })).sort((a, b) => a.speaker.localeCompare(b.speaker, undefined, { numeric: true }));
  const byContext = new Map();
  matched.forEach(cell => {
    if (!byContext.has(cell.context)) byContext.set(cell.context, new Map());
    const group = byContext.get(cell.context);
    if (!group.has(cell.speaker)) group.set(cell.speaker, []);
    group.get(cell.speaker).push(cell.logRatio);
  });
  const contexts = [...byContext].map(([name, group]) => ({
    name, ratio: Math.exp(mean([...group.values()].map(mean))), speakers: group.size,
    cells: [...group.values()].reduce((sum, values) => sum + values.length, 0)
  })).sort((a, b) => a.name.localeCompare(b.name));
  return { kind: "duration", conditionA, conditionB, ratio: Math.exp(mean(speakers.map(speaker => Math.log(speaker.ratio)))),
    speakers, contexts, matchedCells: matched.length, unmatchedCells: unmatched,
    matchedTokens: matched.reduce((sum, cell) => sum + cell.tokens, 0), filteredTokens: filtered.length };
}

export function summarizeF0(rows, { conditionA, conditionB, pair = "", context = "" }) {
  if (!conditionA || !conditionB || conditionA === conditionB) throw new Error("Choose two different conditions.");
  const filtered = rows.filter(row => (!pair || row.pair === pair) && (!context || row.context === context) && [conditionA, conditionB].includes(row.condition));
  const cells = new Map();
  filtered.forEach(row => {
    const id = key(row.speaker, row.pair, row.context, row.time);
    if (!cells.has(id)) cells.set(id, { speaker: row.speaker, time: row.time, groups: new Map() });
    const cell = cells.get(id);
    if (!cell.groups.has(row.condition)) cell.groups.set(row.condition, []);
    cell.groups.get(row.condition).push(row.value);
  });
  const byTimeSpeaker = new Map();
  let unmatched = 0;
  let matchedCells = 0;
  cells.forEach(cell => {
    if (!cell.groups.has(conditionA) || !cell.groups.has(conditionB)) { unmatched += 1; return; }
    matchedCells += 1;
    const id = key(cell.time, cell.speaker);
    if (!byTimeSpeaker.has(id)) byTimeSpeaker.set(id, { time: cell.time, speaker: cell.speaker, a: [], b: [] });
    byTimeSpeaker.get(id).a.push(mean(cell.groups.get(conditionA)));
    byTimeSpeaker.get(id).b.push(mean(cell.groups.get(conditionB)));
  });
  if (!matchedCells) throw new Error("No matched F0 time points have both selected conditions within speaker, pair, and context.");
  const byTime = new Map();
  byTimeSpeaker.forEach(cell => {
    if (!byTime.has(cell.time)) byTime.set(cell.time, []);
    byTime.get(cell.time).push({ speaker: cell.speaker, a: mean(cell.a), b: mean(cell.b), cells: cell.a.length });
  });
  const points = [...byTime].map(([time, speakers]) => ({ time,
    a: mean(speakers.map(item => item.a)), b: mean(speakers.map(item => item.b)),
    difference: mean(speakers.map(item => item.b - item.a)), speakers: speakers.length,
    cells: speakers.reduce((sum, item) => sum + item.cells, 0)
  })).sort((a, b) => a.time - b.time);
  return { kind: "f0", conditionA, conditionB, points, matchedCells, unmatchedCells: unmatched,
    speakerCount: new Set([...byTimeSpeaker.values()].map(item => item.speaker)).size,
    contourCount: new Set(filtered.map(row => row.token)).size, filteredPoints: filtered.length };
}
