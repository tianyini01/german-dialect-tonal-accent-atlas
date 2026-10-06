const requiredColumns = ["speaker_id", "pair_id", "word", "context_id", "condition", "token_id", "time_ms", "duration_ms"];
const key = (...values) => JSON.stringify(values);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const numeric = (value, label, row) => {
  const result = Number(value);
  if (value === "" || !Number.isFinite(result)) throw new Error(`Row ${row}: ${label} must be a finite number.`);
  return result;
};
const label = (value, name, row) => {
  if (!String(value ?? "").trim()) throw new Error(`Row ${row}: ${name} is required.`);
  return String(value).trim();
};

function normalizePhysicalPoints(parsed, measure) {
  const required = [...requiredColumns, measure];
  const missing = required.filter(name => !parsed.headers.includes(name));
  if (missing.length) throw new Error(`Physical-time ${measure === "f0_hz" ? "F0" : "intensity"} CSV is missing ${missing.join(", ")}.`);
  const tokens = new Map();
  const seen = new Set();
  const rows = [];
  let skipped = 0;
  parsed.records.forEach((record, index) => {
    const line = index + 2;
    const row = {
      speaker: label(record.speaker_id, "speaker_id", line),
      pair: label(record.pair_id, "pair_id", line),
      word: label(record.word, "word", line),
      context: label(record.context_id, "context_id", line),
      condition: label(record.condition, "condition", line),
      token: label(record.token_id, "token_id", line),
      time: numeric(record.time_ms, "time_ms", line),
      duration: numeric(record.duration_ms, "duration_ms", line)
    };
    if (row.time < -0.001 || row.duration <= 0 || row.time > row.duration + 1) {
      throw new Error(`Row ${line}: time_ms must be within the measured vowel duration.`);
    }
    if (Math.abs(row.time) < 0.001) row.time = 0;
    const attributes = key(row.speaker, row.pair, row.word, row.context, row.condition, row.duration);
    if (tokens.has(row.token) && tokens.get(row.token) !== attributes) throw new Error(`Row ${line}: token metadata changes across time points.`);
    tokens.set(row.token, attributes);
    const pointKey = key(row.token, row.time);
    if (seen.has(pointKey)) throw new Error(`Row ${line}: duplicate token and time_ms.`);
    seen.add(pointKey);
    if (record[measure] === "" || (measure === "f0_hz" && Number(record[measure]) === 0)) {
      row.value = null;
      skipped += 1;
    } else {
      row.value = numeric(record[measure], measure, line);
      if (measure === "f0_hz" && row.value <= 0) throw new Error(`Row ${line}: voiced f0_hz must exceed zero.`);
    }
    rows.push(row);
  });
  if (!rows.some(row => Number.isFinite(row.value))) throw new Error(`No measured ${measure} values remain.`);
  return { rows, skipped, measure };
}

export function normalizePhysicalF0(parsed) {
  const result = normalizePhysicalPoints(parsed, "f0_hz");
  const hasIntensity = parsed.headers.includes("intensity_db")
    && parsed.records.some(record => record.intensity_db !== "");
  const intensityRows = hasIntensity ? normalizePhysicalIntensity(parsed).rows : [];
  return { kind: "f0", profile: "Measured time and F0", reference: "Hz", ...result, intensityRows };
}

export function normalizePhysicalIntensity(parsed) {
  return normalizePhysicalPoints(parsed, "intensity_db");
}

export function summarizePhysicalF0(rows, binSize = 10, binMode = "nearest") {
  if (!Number.isFinite(binSize) || binSize <= 0) throw new Error("Time bin must exceed zero.");
  if (!["nearest", "observed-lower"].includes(binMode)) throw new Error("Unknown time-bin mode.");
  const valid = rows.filter(row => Number.isFinite(row.value));
  if (!valid.length) throw new Error("No measured F0 or intensity points match these choices.");
  const tokenBins = new Map();
  for (const row of valid) {
    const bin = (binMode === "observed-lower"
      ? Math.floor((row.time + 1e-9) / binSize)
      : Math.round(row.time / binSize)) * binSize;
    const id = key(row.token, bin);
    if (!tokenBins.has(id)) tokenBins.set(id, { bin, speaker: row.speaker, token: row.token, values: [], times: [] });
    tokenBins.get(id).values.push(row.value);
    tokenBins.get(id).times.push(row.time);
  }
  const speakerBins = new Map();
  for (const tokenBin of tokenBins.values()) {
    const id = key(tokenBin.speaker, tokenBin.bin);
    if (!speakerBins.has(id)) speakerBins.set(id, { bin: tokenBin.bin, speaker: tokenBin.speaker, values: [], times: [], tokens: 0 });
    speakerBins.get(id).values.push(mean(tokenBin.values));
    speakerBins.get(id).times.push(mean(tokenBin.times));
    speakerBins.get(id).tokens += 1;
  }
  const timeBins = new Map();
  for (const speakerBin of speakerBins.values()) {
    if (!timeBins.has(speakerBin.bin)) timeBins.set(speakerBin.bin, { values: [], times: [], tokens: 0 });
    timeBins.get(speakerBin.bin).values.push(mean(speakerBin.values));
    timeBins.get(speakerBin.bin).times.push(mean(speakerBin.times));
    timeBins.get(speakerBin.bin).tokens += speakerBin.tokens;
  }
  const points = [...timeBins].map(([bin, group]) => ({
    bin, time: binMode === "observed-lower" ? Math.max(bin, Math.min(bin + binSize, mean(group.times))) : bin,
    value: mean(group.values), speakers: group.values.length, tokens: group.tokens
  })).sort((a, b) => a.bin - b.bin);
  const durations = [...new Map(rows.map(row => [row.token, row.duration])).values()].sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return {
    points,
    pointCount: valid.length,
    missingCount: rows.length - valid.length,
    tokenCount: new Set(valid.map(row => row.token)).size,
    speakerCount: new Set(valid.map(row => row.speaker)).size,
    timeMax: Math.max(...durations),
    durationMedian: durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2
  };
}

export function summarizePhysicalDuration(rows) {
  if (!rows.length) throw new Error("No duration tokens match these choices.");
  const values = rows.map(row => row.value).sort((a, b) => a - b);
  if (values.some(value => !Number.isFinite(value) || value <= 0)) throw new Error("Duration values must be positive milliseconds.");
  const middle = Math.floor(values.length / 2);
  return {
    mean: mean(values),
    median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    min: values[0], max: values[values.length - 1],
    tokenCount: rows.length,
    speakerCount: new Set(rows.map(row => row.speaker)).size
  };
}
