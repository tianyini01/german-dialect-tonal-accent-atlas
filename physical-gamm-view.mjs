const NS = "http://www.w3.org/2000/svg";
const COLORS = ["#087989", "#c07723"];
const W = 760, H = 360, LEFT = 62, RIGHT = 22, TOP = 30, BOTTOM = 54;

const html = (tag, className = "", content = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
};
const svg = (tag, attrs = {}, content = "") => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (content) node.textContent = content;
  return node;
};
const label = (parent, x, y, value, attrs = {}) => parent.append(svg("text", {
  x, y, fill: "#546f7f", "font-size": 12, ...attrs
}, value));
const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });

function unpack(curve) {
  if (!Array.isArray(curve.points) || curve.points.length < 2) throw new Error("Physical-time GAMM curve is incomplete.");
  const points = curve.points.map(point => {
    if (!Array.isArray(point) || point.length !== 4) throw new Error("Physical-time GAMM point is invalid.");
    const [time, fit, lower, upper] = point.map(Number);
    if (![time, fit, lower, upper].every(Number.isFinite) || time < 0 || lower <= 0 || lower > fit || fit > upper)
      throw new Error("Physical-time GAMM point has an invalid measurement.");
    return { time, fit, lower, upper };
  });
  if (points.some((point, index) => index > 0 && point.time <= points[index - 1].time))
    throw new Error("Physical-time GAMM points must have increasing milliseconds.");
  return { ...curve, points };
}

const path = (points, x, y, field) => points.map((point, index) =>
  `${index ? "L" : "M"}${x(point.time).toFixed(2)},${y(point[field]).toFixed(2)}`).join(" ");
const band = (points, x, y) => `${path(points, x, y, "upper")} ${points.slice().reverse().map(point =>
  `L${x(point.time).toFixed(2)},${y(point.lower).toFixed(2)}`).join(" ")} Z`;

export function renderPhysicalTimeGammView({ container, model, context }) {
  if (!container || !model || !Array.isArray(model.curves) || !Array.isArray(model.conditions))
    throw new Error("A physical-time GAMM and target container are required.");
  if (!model.contexts.includes(context)) throw new Error("Choose one recorded context for this model.");
  const curves = model.conditions.map(condition => {
    const matches = model.curves.filter(curve => curve.context === context && curve.condition === condition);
    if (matches.length !== 1) throw new Error(`No unique physical-time GAMM curve for ${condition} in ${context}.`);
    return unpack(matches[0]);
  });
  const maxTime = Math.max(...curves.map(curve => curve.points.at(-1).time));
  const values = curves.flatMap(curve => curve.points.flatMap(point => [point.lower, point.upper]));
  const minValue = Math.min(...values), maxValue = Math.max(...values);
  const pad = Math.max(3, (maxValue - minValue) * .08);
  const lo = Math.max(1, minValue - pad), hi = maxValue + pad;
  const x = time => LEFT + time / maxTime * (W - LEFT - RIGHT);
  const y = value => TOP + (hi - value) / (hi - lo) * (H - TOP - BOTTOM);

  const root = html("section", "gamm-view physical-gamm-view");
  const heading = html("div", "gamm-view-heading");
  heading.append(html("h4", "", `${model.label} · physical-time GAMM refit`),
    html("p", "", `New exploratory model · elapsed vowel time in ms · fitted F0 in Hz · ${context}`));
  root.append(heading);
  const legend = html("div", "gamm-legend physical-gamm-legend");
  curves.forEach((curve, index) => {
    const item = html("span", "gamm-legend-item", `${curve.condition} · median vowel ${number(curve.median_duration_ms)} ms`);
    const mark = html("i");
    mark.style.borderTop = `3px ${index ? "dashed" : "solid"} ${COLORS[index]}`;
    item.prepend(mark);
    legend.append(item);
  });
  root.append(legend);
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `${context}: physical-time GAMM predictions for ${model.conditions.join(" and ")}; their curves stop at different median measured vowel durations` });
  chart.style.width = "100%";
  chart.append(svg("title", {}, `Physical-time GAMM predictions, ${context}`));
  chart.append(svg("desc", {}, "Population F0 predictions in hertz over measured elapsed milliseconds. Pale bands are approximate pointwise 95 percent intervals. Each curve ends at its group's median measured vowel duration."));
  for (let i = 0; i <= 4; i += 1) {
    const value = lo + (hi - lo) * i / 4;
    const yy = y(value);
    chart.append(svg("line", { x1: LEFT, x2: W - RIGHT, y1: yy, y2: yy, stroke: "#dce8ec" }));
    label(chart, LEFT - 9, yy + 4, number(value), { "text-anchor": "end" });
    const time = maxTime * i / 4;
    label(chart, x(time), H - 24, number(time), { "text-anchor": "middle" });
  }
  chart.append(svg("line", { x1: LEFT, x2: W - RIGHT, y1: H - BOTTOM, y2: H - BOTTOM, stroke: "#7e9ba9" }));
  label(chart, LEFT, 17, "F0 (Hz)");
  label(chart, W / 2, H - 4, "Elapsed vowel time (ms)", { "text-anchor": "middle" });
  curves.forEach((curve, index) => {
    chart.append(svg("path", { d: band(curve.points, x, y), fill: COLORS[index], "fill-opacity": .13 }));
    const line = svg("path", { d: path(curve.points, x, y, "fit"), fill: "none", stroke: COLORS[index],
      "stroke-width": 3.3, "stroke-linecap": "round", "stroke-linejoin": "round",
      ...(index ? { "stroke-dasharray": "9 5" } : {}) });
    line.append(svg("title", {}, `${curve.condition}: ${curve.tokens} measured vowels; median duration ${number(curve.median_duration_ms)} ms`));
    chart.append(line);
  });
  root.append(chart);
  root.append(html("p", "gamm-method-note", `The curves are a new mgcv refit of ${number(model.n_voiced_points)} voiced F0 samples from ${number(model.n_tokens)} measured vowels. The model uses actual milliseconds and log Hz with speaker and word-pair random intercepts and tokenwise AR(1) correlation. Curves represent the population fit; the selected speaker and pair do not change it.`));
  root.append(html("p", "gamm-interval-note", "Each line ends at that condition's observed median duration in this context. Duration is not a GAMM prediction. Shading is an approximate pointwise 95% interval; it is not a significance test or a simultaneous confidence band."));
  const provenance = html("details", "gamm-provenance");
  provenance.append(html("summary", "", "Model specification and source"));
  provenance.append(html("code", "", model.formula),
    html("p", "", `Source: ${model.source_file}; SHA-256 ${model.source_sha256}.`),
    html("p", "", `Estimated AR(1) rho: ${model.ar1_rho}. Fitted Hz is a back-transformed geometric mean.`));
  root.append(provenance);
  container.replaceChildren(root);
  return root;
}
