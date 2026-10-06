import { summarizePhysicalF0, summarizePhysicalDuration } from "./physical-analysis.mjs";

const SVG = "http://www.w3.org/2000/svg";
const COLORS = ["#087989", "#d18c34"];
const SAVED_COLORS = ["#7454a5", "#a13d70", "#3655ad", "#637723"];
let nextChartId = 0;
const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
const groupStyle = (groups, index) => groups.length === 4 && Number.isInteger(groups[index].comparisonIndex)
  ? { color: COLORS[groups[index].comparisonIndex], dash: index % 2 ? "9 4" : "" }
  : { color: COLORS[index % COLORS.length], dash: "" };
const shortGroupLabel = (groups, index) => {
  const group = groups[index];
  if (groups.length !== 4) return group.label;
  const comparison = group.comparisonLabel || (group.speaker
    ? `Speaker ${group.speaker}` : `Pair ${group.comparisonIndex === 0 ? "A" : "B"}`);
  return `${comparison} · ${group.condition}`;
};
const node = (tag, content = "", className = "") => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content !== "") item.textContent = content;
  return item;
};
const svg = (tag, attributes = {}, content = "") => {
  const item = document.createElementNS(SVG, tag);
  Object.entries(attributes).forEach(([name, value]) => item.setAttribute(name, String(value)));
  if (content !== "") item.textContent = content;
  return item;
};
const text = (chart, x, y, content, attributes = {}) => {
  const label = svg("text", { x, y, fill: "#5f7b8b", "font-size": 12, ...attributes }, content);
  chart.append(label);
  return label;
};
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

function table(container, caption, headings, rows) {
  const element = node("table");
  element.append(node("caption", caption));
  const head = node("thead");
  const header = node("tr");
  headings.forEach(value => header.append(node("th", value)));
  head.append(header);
  element.append(head);
  const body = node("tbody");
  rows.forEach(values => {
    const row = node("tr");
    values.forEach(value => row.append(node("td", String(value))));
    body.append(row);
  });
  element.append(body);
  container.replaceChildren(element);
}

function kpi(container, value, caption) {
  const card = node("div", "", "kpi");
  card.append(node("strong", value), node("span", caption));
  container.append(card);
}

function numericRange(values, givenMin, givenMax, padding = 0.08) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) throw new Error("No measured values match these choices.");
  const observedMin = Math.min(...finite), observedMax = Math.max(...finite);
  const margin = Math.max(1, (observedMax - observedMin) * padding);
  const lo = givenMin ?? observedMin - margin;
  const hi = givenMax ?? observedMax + margin;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) throw new Error("The display minimum must be below its maximum.");
  return [lo, hi];
}

function axes(chart, { left, right, top, bottom, width, height, lo, hi, xMax, unit, normalized }) {
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = value => left + value / xMax * plotWidth;
  const y = value => top + (hi - value) / (hi - lo) * plotHeight;
  const divisions = width < 420 ? 2 : 4;
  for (let i = 0; i <= divisions; i += 1) {
    const value = lo + (hi - lo) * i / divisions;
    chart.append(svg("line", { x1: left, x2: width - right, y1: y(value), y2: y(value), stroke: "#e3ecef" }));
    text(chart, left - 9, y(value) + 4, number(value), { "text-anchor": "end" });
    const tick = xMax * i / divisions;
    text(chart, x(tick), height - 20, normalized ? `${number(tick)}%` : number(tick), { "text-anchor": "middle" });
  }
  text(chart, left, 14, unit);
  text(chart, width / 2, height - 2, normalized ? "Vowel progress (%)" : "Elapsed vowel time (ms)", { "text-anchor": "middle" });
  return { x, y, plotWidth, plotHeight };
}

function tokenPaths(rows) {
  const groups = new Map();
  rows.forEach(row => {
    if (!groups.has(row.token)) groups.set(row.token, []);
    groups.get(row.token).push(row);
  });
  return [...groups.values()].map(points => {
    points.sort((a, b) => a.time - b.time);
    const intervals = points.slice(1).map((point, index) => point.time - points[index].time).filter(step => step > 0);
    const step = intervals.length ? Math.min(...intervals) : 0;
    return { points, maxGap: step ? step * 1.75 + 0.01 : Infinity };
  });
}

function linePath(points, x, y, maxGap = Infinity) {
  let last = null;
  const parts = [];
  for (const point of points) {
    if (!Number.isFinite(point.value)) { last = null; continue; }
    const position = point.bin ?? point.time;
    parts.push(`${last !== null && position - last <= maxGap ? "L" : "M"}${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`);
    last = position;
  }
  return parts.join(" ");
}

function contourScale(groups, summaries, controls, unit, savedOverlays = []) {
  const values = summaries.flatMap(summary => summary.points.map(point => point.value))
    .concat(savedOverlays.flatMap(({ snapshot }) => snapshot.points.map(point => point.value)));
  const [lo, hi] = numericRange(values, controls.f0Min, controls.f0Max);
  const maxObserved = Math.max(...groups.flatMap(group => group.rows.map(row => row.duration)),
    ...savedOverlays.map(({ snapshot }) => snapshot.duration));
  const xMax = controls.timeAxis === "normalized" ? 100 : controls.timeMax ?? Math.ceil(maxObserved / 10) * 10;
  if (!(xMax > 0)) throw new Error("Time max must be greater than zero milliseconds.");
  return { lo, hi, xMax };
}

function contourNote(controls, savedOverlayCount, { paired = false, faceted = false } = {}) {
  const binNote = controls.timeAxis === "normalized"
    ? "Thick curves are speaker-balanced means in 10-percentage-point bins, placed at the mean observed position within each bin. Only the horizontal time axis is rescaled; F0 remains measured in Hz."
    : "Thick curves are speaker-balanced means of observed values in 10 ms bins. No time normalization is applied.";
  const comparisonNote = faceted
    ? "Both speaker panels share the same time and value scales; teal and orange identify the same two conditions in each panel. "
    : paired ? "Within each comparison item, the first condition is solid and the second is dashed; color identifies the speaker, minimal pair, or dataset. " : "";
  return `${binNote} ${comparisonNote}Mean points with fewer than ${controls.minimumTokens} tokens are hidden when a group has enough observations. ${savedOverlayCount ? "Dotted curves are selected saved individual tokens, not additional group means or records. " : ""}${controls.showTraces ? "Fine curves show individual tokens. " : "Turn on individual token curves in the display controls. "}No extrapolation, invented endpoints, or gap filling.`;
}

function drawContourChart(groups, summaries, controls, unit, title, width, savedOverlays = [], sharedScale = null, showNote = true) {
  const wrap = node("section", "", "physical-chart");
  wrap.append(node("h4", title));
  const w = width, h = width < 420 ? 270 : 320, left = width < 420 ? 43 : 64,
    right = width < 420 ? 12 : 26, top = 23, bottom = 49;
  const normalized = controls.timeAxis === "normalized";
  const { lo, hi, xMax } = sharedScale || contourScale(groups, summaries, controls, unit, savedOverlays);
  const chart = svg("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": `${title}; ${unit} by ${normalized ? "normalized vowel progress" : "actual milliseconds"}` });
  const { x, y, plotWidth, plotHeight } = axes(chart, { left, right, top, bottom, width: w, height: h, lo, hi, xMax, unit, normalized });
  const clipId = `physical-clip-${++nextChartId}`;
  const defs = svg("defs");
  const clip = svg("clipPath", { id: clipId });
  clip.append(svg("rect", { x: left, y: top, width: plotWidth, height: plotHeight }));
  defs.append(clip);
  chart.append(defs);
  const lines = svg("g", { "clip-path": `url(#${clipId})` });
  groups.forEach((group, index) => {
    const style = groupStyle(groups, index);
    if (controls.showTraces) {
      for (const trace of tokenPaths(group.rows)) {
        const path = linePath(trace.points, x, y, trace.maxGap);
        if (path) lines.append(svg("path", { d: path, fill: "none", stroke: style.color,
          "stroke-dasharray": style.dash, "stroke-width": 1, opacity: 0.18 }));
      }
    }
    const points = summaries[index].points;
    const gaps = points.slice(1).map((point, i) => point.bin - points[i].bin).filter(step => step > 0);
    const gap = gaps.length ? Math.min(...gaps) * 1.5 : Infinity;
    const path = linePath(points, x, y, gap);
    lines.append(svg("path", { d: path, fill: "none", stroke: style.color,
      "stroke-dasharray": style.dash, "stroke-width": 3,
      "stroke-linecap": "round", "stroke-linejoin": "round" }));
    points.forEach(point => {
      const dot = svg("circle", { cx: x(point.time), cy: y(point.value), r: 2.5, fill: style.color });
      const position = normalized
        ? `${point.bin === 100 ? "100% sample" : `${point.bin}–<${point.bin + 10}% bin`}; plotted at ${number(point.time)}%`
        : `${point.time} ms`;
      dot.append(svg("title", {}, `${group.label}: ${position}, ${point.value.toFixed(1)} ${unit}; ${point.speakers} speaker IDs, ${point.tokens} tokens`));
      lines.append(dot);
    });
  });
  savedOverlays.forEach(({ snapshot, groupIndex }) => {
    const color = SAVED_COLORS[(snapshot.ordinal - 1) % SAVED_COLORS.length];
    const points = snapshot.points.map(point => ({
      time: normalized ? Math.min(100, Math.max(0, point.time / snapshot.duration * 100)) : point.time,
      value: point.value
    }));
    const intervals = points.slice(1).map((point, index) => point.time - points[index].time)
      .filter(step => step > 0);
    const gap = intervals.length ? Math.min(...intervals) * 1.75 + 0.01 : Infinity;
    const trace = svg("path", { d: linePath(points, x, y, gap), fill: "none", stroke: color,
      "stroke-width": 2.5, "stroke-dasharray": "2 4", "stroke-linecap": "round", "stroke-linejoin": "round" });
    trace.append(svg("title", {}, `Saved token #${snapshot.ordinal}: ${snapshot.word}, ${snapshot.speaker}, ${snapshot.condition}; ${snapshot.state}; compared with ${groups[groupIndex].label}`));
    lines.append(trace);
    points.forEach(point => {
      if (!Number.isFinite(point.value)) return;
      const marker = svg("circle", { cx: x(point.time), cy: y(point.value), r: 2.3,
        fill: color, stroke: "white", "stroke-width": 0.6 });
      marker.append(svg("title", {}, `Saved token #${snapshot.ordinal}: ${number(point.value)} Hz at ${number(point.time)} ${normalized ? "%" : "ms"}`));
      lines.append(marker);
    });
  });
  chart.append(lines);
  wrap.append(chart);
  const legend = node("div", "", "physical-legend");
  groups.forEach((group, index) => {
    const style = groupStyle(groups, index);
    const item = node("span", group.label);
    const mark = node("i");
    mark.style.cssText = `background:none;border-top:3px ${style.dash ? "dashed" : "solid"} ${style.color};height:0`;
    item.prepend(mark);
    legend.append(item);
  });
  savedOverlays.forEach(({ snapshot, groupIndex }) => {
    const item = node("span", `Saved token #${snapshot.ordinal}: ${snapshot.word} · ${snapshot.speaker} · ${snapshot.state} (${groups[groupIndex].label})`);
    const mark = node("i");
    mark.style.cssText = `background:none;border-top:3px dotted ${SAVED_COLORS[(snapshot.ordinal - 1) % SAVED_COLORS.length]};height:0`;
    item.prepend(mark);
    legend.append(item);
  });
  wrap.append(legend);
  if (showNote) wrap.append(node("p", contourNote(controls, savedOverlays.length,
    { paired: groups.length === 4 }), "physical-note"));
  return wrap;
}

function drawSpeakerFacets(groups, summaries, controls, unit, title, width, savedOverlays = []) {
  const layout = node("div", "", "speaker-facet-grid");
  const stacked = width < 660;
  if (stacked) layout.classList.add("is-stacked");
  // Both panels use the range of all four condition curves (and visible saved tokens).
  const sharedScale = contourScale(groups, summaries, controls, unit, savedOverlays);
  const facetWidth = stacked ? width : Math.floor((width - 32) / 2);
  for (let speakerIndex = 0; speakerIndex < 2; speakerIndex += 1) {
    const first = speakerIndex * 2;
    const panelGroups = groups.slice(first, first + 2).map(group => ({ ...group,
      label: `${group.condition}${group.word ? ` · ${group.word}` : ""}` }));
    const panelOverlays = savedOverlays.filter(({ groupIndex }) => groupIndex >= first && groupIndex < first + 2)
      .map(overlay => ({ ...overlay, groupIndex: overlay.groupIndex - first }));
    const panel = node("section", "", "speaker-facet");
    const speaker = groups[first].speaker;
    panel.setAttribute("aria-label", `Speaker ${speaker}: ${title}`);
    panel.append(node("h4", `Speaker ${speaker}`), drawContourChart(panelGroups,
      summaries.slice(first, first + 2), controls, unit, title, facetWidth, panelOverlays, sharedScale, false));
    layout.append(panel);
  }
  layout.append(node("p", contourNote(controls, savedOverlays.length, { faceted: true }), "physical-note"));
  return layout;
}

function visibleSummary(summary, minimumTokens) {
  const highestCoverage = Math.max(...summary.points.map(point => point.tokens));
  const cutoff = Math.min(minimumTokens, highestCoverage);
  return { ...summary, points: summary.points.filter(point => point.tokens >= cutoff) };
}

function withNormalizedTime(rows) {
  return rows.map(row => ({ ...row, time: Math.min(100, Math.max(0, row.time / row.duration * 100)) }));
}

function jitter(id) {
  let hash = 0;
  for (const char of id) hash = ((hash * 31) + char.charCodeAt(0)) | 0;
  return ((hash >>> 0) % 1000) / 1000 - 0.5;
}

function drawDurationChart(groups, summaries, width, speakerBalancedDuration = false) {
  const wrap = node("section", "", "physical-chart");
  wrap.append(node("h4", "Measured vowel duration by comparison group"));
  const w = groups.length === 4 ? Math.max(width, 540) : width;
  const h = w < 420 ? 310 : 340, left = w < 420 ? 43 : 67,
    right = w < 420 ? 12 : 25, top = 24, bottom = 72;
  const values = groups.flatMap(group => group.rows.map(row => row.value));
  const [lo, hi] = numericRange(values, null, null);
  const chart = svg("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": "Individual vowel durations in milliseconds" });
  if (groups.length === 4) chart.style.minWidth = "540px";
  const y = value => top + (hi - value) / (hi - lo) * (h - top - bottom);
  const spacing = (w - left - right) / groups.length;
  const centers = groups.map((group, index) => left + spacing * (index + .5));
  const divisions = w < 420 ? 2 : 4;
  const jitterWidth = Math.min(130, spacing * .63);
  const meanHalfWidth = Math.min(74, spacing * .32);
  for (let i = 0; i <= divisions; i += 1) {
    const value = lo + (hi - lo) * i / divisions;
    chart.append(svg("line", { x1: left, x2: w - right, y1: y(value), y2: y(value), stroke: "#e3ecef" }));
    text(chart, left - 9, y(value) + 4, number(value), { "text-anchor": "end" });
  }
  text(chart, left, 15, "ms");
  groups.forEach((group, index) => {
    const style = groupStyle(groups, index);
    group.rows.forEach(row => {
      const point = svg("circle", { cx: centers[index] + jitter(row.token) * jitterWidth, cy: y(row.value), r: 3.2,
        fill: style.color, opacity: 0.4 });
      point.append(svg("title", {}, `${group.label}: ${row.word}, ${row.speaker}, ${number(row.value)} ms`));
      chart.append(point);
    });
    chart.append(svg("line", { x1: centers[index] - meanHalfWidth, x2: centers[index] + meanHalfWidth,
      y1: y(summaries[index].mean), y2: y(summaries[index].mean), stroke: style.color,
      "stroke-dasharray": style.dash, "stroke-width": 4 }));
    const labelLength = groups.length === 4 ? 20 : (w < 420 ? 16 : 42);
    const shortLabel = shortGroupLabel(groups, index);
    const label = text(chart, centers[index], h - 35,
      shortLabel.length > labelLength ? `${shortLabel.slice(0, labelLength - 1)}…` : shortLabel,
      { "text-anchor": "middle", "font-size": 11 });
    label.append(svg("title", {}, group.label));
    text(chart, centers[index], h - 18, `mean ${number(summaries[index].mean)} ms`, { "text-anchor": "middle", "font-size": 11 });
  });
  wrap.append(chart);
  if (groups.length === 4) {
    const legend = node("div", "", "physical-legend");
    groups.forEach((group, index) => {
      const style = groupStyle(groups, index);
      const item = node("span", group.label);
      const mark = node("i");
      mark.style.cssText = `background:none;border-top:3px ${style.dash ? "dashed" : "solid"} ${style.color};height:0`;
      item.prepend(mark);
      legend.append(item);
    });
    wrap.append(legend);
  }
  wrap.append(node("p", `Each dot is a measured vowel duration in milliseconds; the thick line is ${speakerBalancedDuration
    ? "the equal-weight mean of the speaker or workbook-series means" : "the group mean"}. Groups are shown separately, without pooling datasets or testing significance.`, "physical-note"));
  return wrap;
}

export function renderPhysicalComparison({ kind, groups, controls, title, note, elements,
  savedOverlays = [], speakerFacets = false, speakerBalancedDuration = false }) {
  if (![2, 4].includes(groups.length) || groups.some(group => !group.rows.length)) {
    throw new Error("Every comparison group needs measured records.");
  }
  const { titleNode, profileNode, kpis, chart, summary, noteNode } = elements;
  const paired = groups.length === 4;
  const splitSpeakers = kind === "f0" && speakerFacets && paired
    && groups[0].speaker && groups[0].speaker === groups[1].speaker
    && groups[2].speaker && groups[2].speaker === groups[3].speaker;
  const normalized = kind === "f0" && controls.timeAxis === "normalized";
  titleNode.textContent = title;
  profileNode.textContent = kind === "f0"
    ? normalized ? "Normalized 0–100% · F0 Hz" : "Measured ms · F0 Hz"
    : "Measured duration · ms";
  kpis.replaceChildren();
  kpis.style.gridTemplateColumns = paired ? "repeat(2,minmax(0,1fr))" : "";
  chart.replaceChildren();
  const containerWidth = chart.closest(".overview-card")?.clientWidth
    || chart.closest(".analysis-output")?.clientWidth || 780;
  const width = Math.max(200, Math.min(780, Math.floor(containerWidth - 34)));
  if (kind === "duration") {
    const results = groups.map(group => {
      const result = summarizePhysicalDuration(group.rows);
      if (!speakerBalancedDuration) return result;
      const bySpeaker = new Map();
      group.rows.forEach(row => {
        if (!bySpeaker.has(row.speaker)) bySpeaker.set(row.speaker, []);
        bySpeaker.get(row.speaker).push(row.value);
      });
      return { ...result, mean: mean([...bySpeaker.values()].map(values => mean(values))) };
    });
    if (paired) {
      results.forEach((result, index) => kpi(kpis, `${number(result.mean)} ms`,
        `${shortGroupLabel(groups, index)} mean · ${number(result.tokenCount)} tokens`));
    } else {
      kpi(kpis, `${number(results[0].mean)} ms`, `${groups[0].label} ${speakerBalancedDuration ? "mean across IDs" : "mean"}`);
      kpi(kpis, `${number(results[1].mean)} ms`, `${groups[1].label} ${speakerBalancedDuration ? "mean across IDs" : "mean"}`);
      kpi(kpis, `${number(results[0].tokenCount)} / ${number(results[1].tokenCount)}`, "measured tokens in A / B");
    }
    chart.append(drawDurationChart(groups, results, width, speakerBalancedDuration));
    table(summary, "Measured duration coverage", ["Group", "Speaker IDs", "Tokens",
      speakerBalancedDuration ? "Mean of ID means (ms)" : "Mean (ms)", "Median (ms)", "Range (ms)"],
      groups.map((group, index) => [group.label, results[index].speakerCount, results[index].tokenCount,
        number(results[index].mean), number(results[index].median), `${number(results[index].min)}–${number(results[index].max)}`]));
    noteNode.textContent = `${note} Values are untransformed milliseconds.${speakerBalancedDuration
      ? " The plotted mean weights each contributing speaker or workbook series equally; dots, medians, and ranges remain token-level measurements." : ""} Descriptive comparison only; ${paired
      ? "each condition retains its own measured tokens."
      : "different datasets may have different speakers, words, and recording contexts."}`;
    return { kind, groups: results };
  }
  const plottedGroups = normalized ? groups.map(group => ({ ...group,
    rows: withNormalizedTime(group.rows) })) : groups;
  const binMode = normalized ? "observed-lower" : "nearest";
  const results = plottedGroups.map(group => summarizePhysicalF0(group.rows, 10, binMode));
  const displayed = results.map(result => visibleSummary(result, controls.minimumTokens));
  if (paired) {
    results.forEach((result, index) => kpi(kpis, number(result.tokenCount),
      `${shortGroupLabel(groups, index)} contours · ${number(result.speakerCount)} speaker IDs`));
  } else {
    kpi(kpis, `${number(results[0].tokenCount)} / ${number(results[1].tokenCount)}`, "contours in A / B");
    kpi(kpis, `${number(results[0].pointCount)} / ${number(results[1].pointCount)}`, "measured F0 points in A / B");
    kpi(kpis, `${number(results[0].speakerCount)} / ${number(results[1].speakerCount)}`, "speaker IDs in A / B");
  }
  const durationText = paired
    ? results.map((result, index) => `${shortGroupLabel(groups, index)} ${number(result.durationMedian)} ms`).join(" · ")
    : `A ${number(results[0].durationMedian)} ms · B ${number(results[1].durationMedian)} ms`;
  chart.append(node("p", `Measured median vowel duration: ${durationText}. ${normalized
    ? "The 0–100% axis hides this time difference."
    : "The millisecond axis lets the contours span different lengths."}`, "physical-context"));
  const f0Title = normalized ? "F0 by normalized vowel time" : "F0 on actual elapsed vowel time";
  chart.append(splitSpeakers
    ? drawSpeakerFacets(plottedGroups, displayed, controls, "Hz", f0Title, width, savedOverlays)
    : drawContourChart(plottedGroups, displayed, controls, "Hz", f0Title, width, savedOverlays));
  table(summary, "F0 coverage and measured duration", ["Group", "Speaker IDs", "Contours", "Measured Hz points", "Missing/unvoiced", "Median vowel (ms)", "Longest vowel (ms)"],
    groups.map((group, index) => [group.label, results[index].speakerCount, results[index].tokenCount,
      number(results[index].pointCount), number(results[index].missingCount), number(results[index].durationMedian), number(results[index].timeMax)]));
  noteNode.textContent = normalized
    ? `${note} Each token's horizontal position is elapsed time divided by its measured duration. F0 remains measured Hz. Group means use observed 10-percentage-point bins. Leer and Aachen have different sampling methods, and the normalized axis hides duration differences. These are descriptive displays, not inferential estimates.`
    : `${note} F0 values are measured hertz at physical times after vowel onset. Thick curves summarize observed 10 ms bins; counts can fall at later times as vowels end. These are descriptive displays, not inferential estimates.`;
  return { kind, timeAxis: normalized ? "normalized" : "actual", groups: results,
    savedOverlayCount: savedOverlays.length,
    savedOverlayIds: savedOverlays.map(({ snapshot }) => snapshot.id) };
}
