const SVG_NS = "http://www.w3.org/2000/svg";
const COLORS = ["#087989", "#c07723"];
const WIDTH = 600;
const HEIGHT = 290;
const LEFT = 55;
const RIGHT = 18;
const TOP = 34;
const BOTTOM = 48;

function html(tag, className = "", content = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content) item.textContent = content;
  return item;
}

function svg(tag, attributes = {}, content = "") {
  const item = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) item.setAttribute(name, String(value));
  if (content) item.textContent = content;
  return item;
}

function label(chart, x, y, content, attributes = {}) {
  chart.append(svg("text", { x, y, fill: "#546f7f", "font-size": 12, ...attributes }, content));
}

function numeric(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function unpack(curve) {
  if (!Array.isArray(curve.points) || !curve.points.length) throw new Error("GAMM curve has no prediction points.");
  const points = curve.points.map(point => {
    if (!Array.isArray(point) || point.length < 5) throw new Error("GAMM prediction point has an invalid shape.");
    const [time, fit, se, lower, upper] = point.map(Number);
    if (![time, fit, se, lower, upper].every(Number.isFinite) || time < 0 || time > 100 || lower > upper)
      throw new Error("GAMM prediction point contains an invalid value.");
    return { time, fit, lower, upper };
  }).sort((a, b) => a.time - b.time);
  if (points.some((point, index) => index && point.time === points[index - 1].time))
    throw new Error("GAMM curve repeats a normalized time point.");
  return { context: curve.context, condition: curve.condition, points };
}

function path(points, x, y, field) {
  return points.map((point, index) => `${index ? "L" : "M"}${x(point.time).toFixed(2)},${y(point[field]).toFixed(2)}`).join(" ");
}

function intervalPath(points, x, y) {
  const upper = path(points, x, y, "upper");
  const lower = points.slice().reverse().map(point => `L${x(point.time).toFixed(2)},${y(point.lower).toFixed(2)}`).join(" ");
  return `${upper} ${lower} Z`;
}

function durationSummary(rows, context) {
  const tokens = new Map();
  for (const row of rows || []) {
    if (row?.context !== context || !row.token || !Number.isFinite(row.duration) || row.duration <= 0) continue;
    // Each F0 token contributes many time samples, but only one vowel duration.
    const key = `${row.speaker || ""}\u0000${row.token}`;
    if (!tokens.has(key)) tokens.set(key, row.duration);
  }
  const values = [...tokens.values()].sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return {
    count: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
  };
}

function drawDurationCompanion(context, conditions, measuredDurationGroups) {
  if (!Array.isArray(measuredDurationGroups)) return null;
  const summary = html("div", "gamm-duration-companion");
  summary.style.cssText = "margin-top:.75rem;padding-top:.7rem;border-top:1px solid #dce8ec";
  const heading = html("h6", "", "Measured vowel duration in the site table");
  heading.style.cssText = "margin:0 0 .35rem;font-size:.78rem;color:#244d5d";
  summary.append(heading);
  const table = html("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:.77rem;color:#244d5d";
  const header = html("tr");
  for (const name of ["Condition", "Mean ms", "Median ms", "Tokens"]) {
    const cell = html("th", "", name);
    cell.scope = "col";
    cell.style.cssText = "padding:3px 5px;text-align:left;border-bottom:1px solid #dce8ec";
    header.append(cell);
  }
  table.append(header);
  conditions.forEach((condition, index) => {
    const group = measuredDurationGroups.find(item => item.condition === condition);
    const stats = durationSummary(group?.rows, context);
    const row = html("tr");
    const values = [condition, stats ? numeric(stats.mean) : "—", stats ? numeric(stats.median) : "—", stats ? String(stats.count) : "0"];
    values.forEach((value, cellIndex) => {
      const cell = html("td", "", value);
      cell.style.cssText = `padding:4px 5px;border-bottom:1px solid #edf3f4;${cellIndex === 0 ? `border-left:3px solid ${COLORS[index]};font-weight:600` : ""}`;
      row.append(cell);
    });
    table.append(row);
  });
  summary.append(table);
  const note = html("p", "", "Descriptive token durations from all speakers and word pairs in the included physical-time F0 table for this context; one duration per token. These are not GAMM predictions or model intervals.");
  note.style.cssText = "margin:.35rem 0 0;color:#567080;font-size:.72rem;line-height:1.4";
  summary.append(note);
  return summary;
}

function drawFacet(context, curves, conditions, scaleLabel, extent, measuredDurationGroups) {
  const facet = html("section", "gamm-facet");
  facet.append(html("h5", "gamm-facet-title", context));
  const chart = svg("svg", {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    role: "img",
    "aria-label": `${context}: original GAMM population predictions for ${conditions.join(" and ")} in ${scaleLabel} over normalized vowel time`
  });
  chart.style.width = "100%";
  chart.style.height = "auto";
  chart.append(svg("title", {}, `GAMM-predicted F0, ${context}`));
  chart.append(svg("desc", {}, "Colored curves are population predictions; pale bands are approximate pointwise 95% intervals. The horizontal axis is normalized vowel time from 0 to 100%."));
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const x = time => LEFT + time / 100 * plotWidth;
  const y = value => TOP + (extent.hi - value) / (extent.hi - extent.lo) * plotHeight;
  for (let index = 0; index <= 4; index += 1) {
    const value = extent.lo + (extent.hi - extent.lo) * index / 4;
    const yy = y(value);
    chart.append(svg("line", { x1: LEFT, x2: WIDTH - RIGHT, y1: yy, y2: yy, stroke: "#dce8ec" }));
    label(chart, LEFT - 8, yy + 4, numeric(value), { "text-anchor": "end" });
    const time = index * 25;
    label(chart, x(time), HEIGHT - 20, `${time}%`, { "text-anchor": "middle" });
  }
  chart.append(svg("line", { x1: LEFT, x2: WIDTH - RIGHT, y1: HEIGHT - BOTTOM, y2: HEIGHT - BOTTOM, stroke: "#7e9ba9" }));
  label(chart, LEFT, 17, scaleLabel, { "font-size": 12 });
  label(chart, WIDTH / 2, HEIGHT - 2, "Normalized vowel time", { "text-anchor": "middle" });
  conditions.forEach((condition, index) => {
    const curve = curves.find(item => item.condition === condition);
    if (!curve) return;
    const color = COLORS[index];
    chart.append(svg("path", { d: intervalPath(curve.points, x, y), fill: color, "fill-opacity": 0.13, stroke: "none" }));
    const line = svg("path", {
      d: path(curve.points, x, y, "fit"), fill: "none", stroke: color,
      "stroke-width": 3.4, "stroke-linecap": "round", "stroke-linejoin": "round",
      ...(index ? { "stroke-dasharray": "9 5" } : {})
    });
    line.append(svg("title", {}, `${condition} model prediction`));
    chart.append(line);
  });
  facet.append(chart);
  const durationCompanion = drawDurationCompanion(context, conditions, measuredDurationGroups);
  if (durationCompanion) facet.append(durationCompanion);
  return facet;
}

/**
 * Render one original, precomputed research GAMM. This renderer does not fit or
 * update a model; the caller must show it only for its eligible source view.
 * `context` is one exact context label; different contexts are never pooled.
 * `measuredDurationGroups` contains the unfiltered physical-time site-table
 * rows by model condition; its descriptive summaries are separate from the GAMM.
 */
export function renderGammView({ container, model, context, measuredDurationGroups = null }) {
  if (!container || !model || !Array.isArray(model.curves)) throw new Error("A GAMM model and target container are required.");
  const conditions = model.conditions;
  const contexts = model.contexts;
  if (!Array.isArray(conditions) || conditions.length !== 2 || !Array.isArray(contexts) || !contexts.length)
    throw new Error("GAMM model needs two conditions and its recorded contexts.");
  if (!context || !contexts.includes(context)) throw new Error("Choose one context in the original GAMM model.");
  const visibleContexts = [context];
  const allCurves = model.curves.map(unpack);
  const selectedCurves = allCurves.filter(curve => visibleContexts.includes(curve.context) && conditions.includes(curve.condition));
  for (const name of visibleContexts) {
    for (const condition of conditions) {
      if (selectedCurves.filter(curve => curve.context === name && curve.condition === condition).length !== 1)
        throw new Error(`GAMM predictions are incomplete for ${name} and ${condition}.`);
    }
  }
  const values = selectedCurves.flatMap(curve => curve.points.flatMap(point => [point.lower, point.upper]));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max(0.5, (maximum - minimum) * 0.08);
  const extent = { lo: minimum - padding, hi: maximum + padding };
  const root = html("section", "gamm-view");
  const heading = html("div", "gamm-view-heading");
  heading.append(html("h4", "", `${model.label || "Original research"} GAMM predictions`));
  heading.append(html("p", "", `Model F0: normalized vowel time (0–100%) · ${model.scale_label || "F0 (semitones)"}${measuredDurationGroups ? " · measured vowel durations below in ms" : ""}`));
  root.append(heading);
  const legend = html("div", "gamm-legend");
  legend.style.display = "flex";
  legend.style.flexWrap = "wrap";
  legend.style.gap = "8px 18px";
  conditions.forEach((condition, index) => {
    const item = html("span", "gamm-legend-item", condition);
    item.style.display = "inline-flex";
    item.style.alignItems = "center";
    item.style.gap = "7px";
    const mark = html("i");
    mark.style.display = "inline-block";
    mark.style.width = "25px";
    mark.style.borderTop = `3px ${index ? "dashed" : "solid"} ${COLORS[index]}`;
    item.prepend(mark);
    legend.append(item);
  });
  root.append(legend);
  const grid = html("div", "gamm-facet-grid");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(min(100%, 470px), 1fr))";
  grid.style.gap = "14px";
  visibleContexts.forEach(name => grid.append(drawFacet(name,
    selectedCurves.filter(curve => curve.context === name), conditions,
    model.scale_label || "F0 (semitones)", extent, measuredDurationGroups)));
  root.append(grid);
  const details = [
    Number.isFinite(model.n_model_tokens) ? `${numeric(model.n_model_tokens)} modeled contours` : "",
    Number.isFinite(model.n_model_points) ? `${numeric(model.n_model_points)} modeled F0 points` : "",
    Number.isFinite(model.n_speakers) ? `${numeric(model.n_speakers)} speakers` : ""
  ].filter(Boolean).join(" · ");
  if (details) root.append(html("p", "gamm-coverage", details));
  if (measuredDurationGroups) {
    const observedTokens = new Set();
    for (const group of measuredDurationGroups) {
      if (!contexts.length || !conditions.includes(group.condition)) continue;
      for (const row of group.rows || []) {
        if (contexts.includes(row.context) && row.token && Number.isFinite(row.duration) && row.duration > 0)
          observedTokens.add(`${group.condition}\u0000${row.context}\u0000${row.speaker || ""}\u0000${row.token}`);
      }
    }
    if (Number.isFinite(model.n_model_tokens)) root.append(html("p", "gamm-coverage",
      `Original GAMM input: ${numeric(model.n_model_tokens)} contours. Separate physical-time site table: ${numeric(observedTokens.size)} tokens with measured durations. These counts do not establish identical token samples.`));
  }
  root.append(html("p", "gamm-method-note", model.method_note ||
    "These are precomputed population predictions from the original research GAMM. Random effect contributions are excluded from the displayed curves."));
  root.append(html("p", "gamm-interval-note",
    `${model.confidence_label || "Approximate pointwise 95% intervals"} are shaded. Curves are model estimates on the original semitone scale, not measured Hz contours. Any duration summaries come from the included physical-time F0 table, whose tokens may differ from the original model input. This view does not refit when speaker or pair filters change.`));
  const provenance = html("details", "gamm-provenance");
  provenance.append(html("summary", "", "Model specification and source"));
  if (model.model_formula) {
    const formula = html("code", "", model.model_formula);
    formula.style.display = "block";
    formula.style.whiteSpace = "pre-wrap";
    formula.style.overflowWrap = "anywhere";
    provenance.append(formula);
  }
  const sourceName = typeof model.source === "string" ? model.source.split(/[\\/]/).pop() : "";
  if (sourceName) provenance.append(html("p", "", `Original prediction table: ${sourceName}.`));
  if (model.source_batch_label) provenance.append(html("p", "", `Original analysis batch: ${model.source_batch_label}.`));
  if (Number.isFinite(model.ar1_rho)) provenance.append(html("p", "", `Fitted AR(1) rho: ${Number(model.ar1_rho).toFixed(3)}.`));
  if (Array.isArray(model.excluded_random_terms) && model.excluded_random_terms.length)
    provenance.append(html("p", "", `Population prediction excludes: ${model.excluded_random_terms.join(", ")}.`));
  root.append(provenance);
  container.replaceChildren(root);
  return root;
}
