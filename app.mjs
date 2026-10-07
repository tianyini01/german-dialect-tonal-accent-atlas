import { parseCsv, normalizeCsv, levels } from "./analysis.mjs";
import { normalizePhysicalF0 } from "./physical-analysis.mjs";
import { renderPhysicalComparison } from "./physical-ui.mjs?v=19";
import { comparisonConditions, comparablePairNames, matchedSpeakerGroups,
  sharedSpeakerPairs } from "./speaker-comparison.mjs";
import { renderGammView } from "./gamm-view.mjs";
import { renderPhysicalTimeGammView } from "./physical-gamm-view.mjs";
import { renderAtlasMap } from "./atlas.mjs?v=22";
import { renderLiveAtlasMap, destroyLiveAtlasMap } from "./live-atlas.mjs?v=22";
import { languageColor } from "./map-palette.mjs";
import { linkedWordSets, orderLinkedGroups } from "./linked-word-sets.mjs?v=19";
import { renderEvidenceCard } from "./evidence-cards.mjs";

const $ = id => document.getElementById(id);
const state = { catalog: [], basemap: null, loaded: null, loadedSet: null, loadedSource: "", loadedUnit: "speaker",
  comparisonLoaded: null, comparisonSet: null, loadRequest: 0, compareRequest: 0, liveMapFailed: false, lastResult: null,
  uploadTarget: null, sessionUploads: new Map(), includedCache: new Map(), localityEntries: [],
  detailActive: false, durationEntryId: null, gammModels: null, physicalGammModels: null, activeDialectId: null,
  linkedLoaded: null, linkedRequest: 0, workspaceKind: null, boundaries: null };
const gammSetKeys = { "leer-f0": "leer", "aachen-f0": "aachen" };
const element = (tag, className = "", content = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== "") node.textContent = content;
  return node;
};
const format = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const findSet = id => state.catalog.flatMap(dialect => dialect.measurementSets.map(set => ({ dialect, set }))).find(item => item.set.id === id);
const findDialect = id => state.catalog.find(dialect => dialect.id === id);
const activeDialect = () => findDialect(state.activeDialectId);
const mapCatalog = () => state.catalog.filter(dialect => $("literature-layer").checked
  || dialect.measurementSets.some(set => set.dataFile));
const orderedSets = dialect => [...dialect.measurementSets].sort((a, b) =>
  Number(b.kind === dialect.typology?.preferredMeasurement) - Number(a.kind === dialect.typology?.preferredMeasurement));
const visibleLocalityEntries = () => state.localityEntries.filter(entry =>
  activeDialect()?.typology?.profile !== "quantity" || state.workspaceKind !== "duration"
  || entry.selected.set.kind === "duration");
const uploadsForDialect = dialect => [...state.sessionUploads.values()].filter(upload => upload.dialect.id === dialect.id);
const pairedF0 = () => {
  if (state.loaded?.kind !== "f0") return false;
  if (["leer-f0", "aachen-f0"].includes(state.loadedSet?.set.id)) return true;
  const rows = state.loaded.rows, conditions = comparisonConditions(rows);
  if (conditions.length !== 2) return false;
  return completePairNames(rows, { conditions }).some(pair => {
    const words = conditions.map(condition => new Set(rows.filter(row => row.pair === pair && row.condition === condition)
      .map(row => row.word)));
    return [...words[0]].some(word => !words[1].has(word)) || [...words[1]].some(word => !words[0].has(word));
  });
};
const pairedDuration = () => state.loaded?.kind === "duration"
  && Boolean(state.loadedSet?.set.id && !state.loadedSet.set.id.startsWith("upload:"))
  && comparisonConditions(state.loaded.rows).length === 2;
const boundPairComparison = () => pairedF0() || pairedDuration();
const pairedDataset = () => $("compare-mode").value === "dataset" && boundPairComparison();
const sameWordConditions = loaded => loaded?.kind === "duration"
  && [...new Set(loaded.rows.map(row => row.pair))].some(pair => {
    const words = [...new Set(loaded.rows.filter(row => row.pair === pair).map(row => row.word))];
    return words.length === 1;
  });
const preferredContext = (rows, set) => {
  const contexts = levels(rows, "context");
  return contexts.find(value => /\bdeclarative\b.*\bnon[- ]final\b/i.test(value))
    || (contexts.includes(set?.defaultContext) ? set.defaultContext : contexts[0] || "");
};
const contextKey = value => value.toLowerCase().replace(/non[-\s]?final/g, "nonfinal")
  .replace(/\bfocus\b/g, "").replace(/[\s_-]+/g, " ").trim();
const matchingContext = (rows, set, firstContext) => {
  const contexts = levels(rows, "context");
  const key = contextKey(firstContext);
  return contexts.find(value => value === firstContext)
    || (key && contexts.find(value => contextKey(value) === key))
    || preferredContext(rows, set);
};
function completePairedCells(rows, { speaker = "", context = "", conditions = comparisonConditions(rows), distinctWords = true } = {}) {
  if (conditions.length !== 2) return [];
  const cells = new Map();
  for (const row of rows) {
    if (speaker && row.speaker !== speaker) continue;
    if (context && row.context !== context) continue;
    const key = JSON.stringify([row.speaker, row.pair, row.context]);
    if (!cells.has(key)) cells.set(key, { key, pair: row.pair, words: new Map() });
    const cell = cells.get(key);
    if (!cell.words.has(row.condition)) cell.words.set(row.condition, new Map());
    const words = cell.words.get(row.condition);
    words.set(row.word, (words.get(row.word) || false) || Number.isFinite(row.value));
  }
  return [...cells.values()].filter(cell => {
    const words = conditions.map(condition => cell.words.get(condition));
    return words.every(items => items?.size === 1 && [...items.values()][0])
      && (!distinctWords || [...words[0].keys()][0] !== [...words[1].keys()][0]);
  });
}
function completePairNames(rows, filters = {}) {
  return [...new Set(completePairedCells(rows, filters).map(cell => cell.pair))];
}
function conditionGroupsForPair(loaded, { pair, context = "", speaker = "", conditions }) {
  const cells = completePairedCells(loaded.rows, { speaker, context, conditions,
    distinctWords: !sameWordConditions(loaded) }).filter(cell => cell.pair === pair);
  const completeKeys = new Set(cells.map(cell => cell.key));
  const belongs = row => completeKeys.has(JSON.stringify([row.speaker, row.pair, row.context]));
  return conditions.map(condition => ({
    label: `${condition}: ${[...new Set(cells.map(cell => [...cell.words.get(condition).keys()][0]))].join(" / ")} · ${pair}`,
    rows: loaded.rows.filter(row => belongs(row) && row.condition === condition),
    intensityRows: (loaded.intensityRows || []).filter(row => belongs(row) && row.condition === condition)
  }));
}
function defaultPairedSelection(rows, set, distinctWords = true) {
  const speaker = levels(rows, "speaker")[0] || "";
  const context = preferredContext(rows, set);
  const pair = completePairNames(rows, { speaker, context, distinctWords })[0]
    || completePairNames(rows, { speaker, distinctWords })[0] || "";
  return { speaker, context, pair };
}
function entryForUpload(upload) {
  const conditions = levels(upload.loaded.rows, "condition");
  return { upload: true, loaded: upload.loaded, selected: { dialect: upload.dialect, set: {
    id: `upload:${upload.dialect.id}:${upload.kind}`, kind: upload.kind,
    title: upload.fileName, summary: "Opened from this device; available in this workspace until the page is reloaded.",
    defaultConditionA: conditions[0], defaultConditionB: conditions[1],
    timeBasis: "Session-only local CSV; source measurements remain separate from included research sets."
  } } };
}
async function chooseSetAndAnalyze(set) {
  const selected = findSet(set.id);
  if (!selected) return;
  state.uploadTarget = null;
  state.activeDialectId = selected.dialect.id;
  if ($("dataset-dialog").open) $("dataset-dialog").close();
  $("analysis").scrollIntoView({ behavior: "smooth" });
  await onSourceChange(set.id);
}
async function openDialectWorkspace(dialect) {
  if (!dialect.measurementSets.some(set => set.dataFile)) { showDialect(dialect); return; }
  state.uploadTarget = null;
  state.activeDialectId = dialect.id;
  if ($("dataset-dialog").open) $("dataset-dialog").close();
  $("analysis").scrollIntoView({ behavior: "smooth" });
  await onSourceChange();
}
async function openLocalCsvForDialect(dialect, kind) {
  state.uploadTarget = { dialect, kind };
  if (state.activeDialectId !== dialect.id) {
    state.activeDialectId = dialect.id;
    await onSourceChange();
  }
  $("analysis-mode").value = kind;
  $("analysis-mode").disabled = false;
  updateMode();
  $("custom-data-panel").open = true;
  $("source-note").textContent = `${dialect.title}: choose a ${kind === "f0" ? "time-stamped F0" : "vowel-duration"} CSV from this device. It remains available until this page is reloaded and is not added to the atlas catalog.`;
  if ($("dataset-dialog").open) $("dataset-dialog").close();
  $("analysis").scrollIntoView({ behavior: "smooth" });
  $("file-input").focus({ preventScroll: true });
}
async function chooseUploadedAndAnalyze(upload) {
  state.uploadTarget = { dialect: upload.dialect, kind: upload.kind };
  if (state.activeDialectId !== upload.dialect.id) {
    state.activeDialectId = upload.dialect.id;
    await onSourceChange();
  }
  $("analysis-mode").value = upload.kind;
  $("analysis-mode").disabled = false;
  $("custom-data-panel").open = true;
  updateMode();
  $("source-note").textContent = `${upload.label} · available until this page is reloaded.`;
  const entry = state.localityEntries.find(item => item.upload && item.loaded === upload.loaded) || entryForUpload(upload);
  if (!state.localityEntries.includes(entry)) {
    state.localityEntries.push(entry);
    renderLocalityOverview(upload.dialect);
  }
  showLoadedData(upload.loaded, upload.label, entry.selected);
  if ($("dataset-dialog").open) $("dataset-dialog").close();
  $("analysis").scrollIntoView({ behavior: "smooth" });
}

function filteredCatalog() {
  const query = $("search").value.trim().toLowerCase();
  const family = $("family-filter").value;
  const contrast = $("contrast-filter").value;
  const place = $("place-filter").value;
  return mapCatalog().filter(dialect => {
    const searchable = [dialect.title, dialect.family, dialect.place, dialect.summary,
      dialect.typology?.contrast, dialect.typology?.accentPattern, dialect.typology?.quantityPattern,
      ...dialect.measurementSets.flatMap(set => [set.title, set.summary, ...set.variables])].join(" ").toLowerCase();
    return (!query || searchable.includes(query)) && (!family || dialect.family === family)
      && (!contrast || dialect.typology?.profile === contrast) && (!place || dialect.place === place);
  });
}
function placesForFamily(family, contrast = $("contrast-filter").value) {
  return [...new Set(mapCatalog().filter(dialect => (!family || dialect.family === family)
    && (!contrast || dialect.typology?.profile === contrast))
    .map(dialect => dialect.place).filter(Boolean))].sort();
}
function updatePlaceOptions() {
  const select = $("place-filter");
  const previous = select.value;
  const places = placesForFamily($("family-filter").value);
  const all = element("option", "", "All places");
  all.value = "";
  select.replaceChildren(all, ...places.map(place => {
    const option = element("option", "", place);
    option.value = place;
    return option;
  }));
  select.value = places.includes(previous) ? previous : "";
}
function renderCatalog() {
  const filtered = filteredCatalog();
  const mapContainer = $("atlas-map");
  const entries = mapCatalog();
  const boundaries = $("boundary-layer").checked ? state.boundaries : null;
  const visibleIds = new Set(filtered.map(dialect => dialect.id));
  const onMapSelect = dialect => {
    if (!filtered.some(item => item.id === dialect.id)) {
      $("search").value = "";
      $("family-filter").value = "";
      $("contrast-filter").value = "";
      updatePlaceOptions();
      $("place-filter").value = "";
      renderCatalog();
    }
    openDialectWorkspace(dialect);
  };
  if (window.L && !state.liveMapFailed) {
    try {
      if (!mapContainer.classList.contains("leaflet-host")) {
        mapContainer.replaceChildren();
        mapContainer.removeAttribute("tabindex");
        mapContainer.classList.add("leaflet-host");
      }
      renderLiveAtlasMap(mapContainer, entries, visibleIds, onMapSelect, () => {
        state.liveMapFailed = true;
        destroyLiveAtlasMap(mapContainer);
        mapContainer.classList.remove("leaflet-host");
        renderCatalog();
      }, boundaries);
      $("map-mode").textContent = "Live street map: drag, scroll or pinch to explore.";
    } catch {
      state.liveMapFailed = true;
      destroyLiveAtlasMap(mapContainer);
      mapContainer.classList.remove("leaflet-host");
      renderAtlasMap(mapContainer, entries, visibleIds, state.basemap, onMapSelect, boundaries);
      $("map-mode").textContent = "Online street map unavailable; showing the offline outline.";
    }
  } else {
    renderAtlasMap(mapContainer, entries, visibleIds, state.basemap, onMapSelect, boundaries);
    $("map-mode").textContent = "Online street map unavailable; showing the offline outline.";
  }
  const mappedAreas = state.catalog.filter(dialect => dialect.map.distributionGeometry && dialect.map.distributionSource).length;
  $("distribution-note").textContent = mappedAreas
    ? `${mappedAreas} evidence-backed dialect area ${mappedAreas === 1 ? "layer is" : "layers are"} shown.`
    : boundaries?.features?.length
      ? "Dashed line: approximate trace of the published tonal isogloss; the southern extent is cropped in the source figure."
      : "Town labels show cited descriptions; unlabelled areas remain unclassified.";
  $("catalog-empty").hidden = filtered.length > 0;
}

function renderPatternDescription(container, dialect) {
  container.replaceChildren();
  const typology = dialect.typology;
  if (!typology?.patternRows?.length) return;
  container.append(element("h3", "", "Published accent pattern"));
  const wrap = element("div", "table-wrap");
  const table = element("table", "pattern-table");
  const caption = element("caption", "", typology.patternContext || "Focused, non-final position · historically corresponding word classes");
  table.append(caption);
  const head = element("thead");
  const headings = element("tr");
  ["Context", ...(typology.patternClassLabels || ["Class 1", "Class 2"])].forEach(label => {
    const cell = element("th", "", label); cell.scope = "col"; headings.append(cell);
  });
  head.append(headings);
  const body = element("tbody");
  typology.patternRows.forEach(pattern => {
    const row = element("tr");
    const context = element("th", "", pattern.context); context.scope = "row";
    row.append(context, element("td", "", pattern.class1), element("td", "", pattern.class2));
    body.append(row);
  });
  table.append(head, body); wrap.append(table); container.append(wrap);
  container.append(element("p", "field-note", typology.patternNote));
}

function renderWorkspaceProfile(dialect) {
  const profile = $("workspace-profile");
  profile.hidden = false;
  profile.replaceChildren(element("strong", "", `${dialect.title} · ${dialect.typology.contrast}`),
    element("p", "", dialect.typology.profile === "quantity"
      ? `${dialect.typology.quantityPattern} ${dialect.typology.accentStatus}`
      : dialect.typology.accentPattern));
  const button = element("button", "quiet-button", "View contrast profile and sources");
  button.type = "button"; button.addEventListener("click", () => showDialect(dialect));
  profile.append(button);
}

function showDialect(dialect) {
  $("dialog-type").textContent = dialect.family.toUpperCase();
  $("dialog-title").textContent = dialect.title;
  $("dialog-summary").textContent = dialect.summary;
  renderPatternDescription($("dialog-pattern"), dialect);
  const fields = [
    ["Variety", dialect.title], ["Language group", dialect.language || dialect.family],
    ["Location", `${dialect.place}. ${dialect.placeNote}`],
    ["Map position", `${dialect.map.precision}; source: ${dialect.map.source}. ${dialect.map.distributionGeometry && dialect.map.distributionSource ? `Dialect-area source: ${dialect.map.distributionSource}.` : "No verified dialect-area boundary."}`],
    ["Accent status", dialect.typology?.accentStatus || "Not established"],
    ["Accent pattern", dialect.typology?.accentPattern || "Not established"],
    ["Vowel length", dialect.typology?.quantityPattern || "Not established"],
    ["Classification basis", dialect.typology?.basis || "Not established"],
    ["Evidence in this atlas", dialect.typology?.atlasEvidence || "No comparable measurements"],
    ["Interpretation limit", dialect.typology?.caveat || "Classification requires further evidence"],
    ["Speakers", Number.isInteger(dialect.speakerCount) ? `${dialect.speakerCount} pseudonymous ${dialect.speakerCount === 1 ? "speaker ID" : "speaker IDs"}; demographics not verified` : "Count not established for this review entry"],
    ["Recordings", dialect.recordings], ["Data access", dialect.access]
  ];
  const dl = $("dialog-fields");
  dl.replaceChildren();
  fields.forEach(([label, value]) => { dl.append(element("dt", "", label), element("dd", "", value)); });
  if (dialect.typology?.sources?.length) {
    const references = element("dd", "typology-sources");
    dialect.typology.sources.forEach((source, index) => {
      if (index) references.append(document.createTextNode(" · "));
      const link = element("a", "", source.label);
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      references.append(link);
    });
    dl.append(element("dt", "", "Sources"), references);
  }
  const sets = $("dialog-measurements");
  sets.replaceChildren(element("h3", "", "Available measurements"));
  if (!dialect.measurementSets.length) sets.append(element("p", "field-note", "Literature entry. No token measurements or model curves from this place are included in the atlas."));
  const sessionUploads = uploadsForDialect(dialect);
  orderedSets(dialect).forEach(set => {
    const section = element("section", "dialog-set");
    const auxiliaryF0 = dialect.typology?.profile === "quantity" && set.kind === "f0";
    section.append(element("h4", "", auxiliaryF0 ? `${set.title} · supplementary measurement` : set.title));
    if (auxiliaryF0) section.append(element("p", "", "Measured F0 is available as supplementary data. Its presence does not establish a tonal accent contrast."));
    if (set.rowCount != null) section.append(element("p", "", `${format(set.rowCount)} ${set.rowUnit} · ${set.itemCount} · ${set.contextCount}`));
    section.append(element("p", "", set.summary));
    const details = element("details", "set-details-toggle");
    details.append(element("summary", "", "Source and method"),
      element("p", "set-details", `Variables: ${(set.variables || []).join(", ")}. Source: ${set.source}. Method: ${set.method}`));
    section.append(details);
    const button = element("button", "quiet-button", set.dataFile ? set.kind === "f0" ? "Compare F0 contours" : "Compare durations" : "Open a CSV for comparison");
    button.type = "button";
    button.addEventListener("click", () => set.dataFile ? chooseSetAndAnalyze(set) : openLocalCsvForDialect(dialect, set.kind));
    section.append(button);
    sets.append(section);
  });
  sessionUploads.forEach(upload => {
    const section = element("section", "dialog-set");
    section.append(element("h4", "", `Your ${upload.kind === "f0" ? "F0 contour" : "vowel-duration"} CSV`));
    section.append(element("p", "", `${upload.fileName} · available for comparison until this page is reloaded.`));
    const button = element("button", "quiet-button", "Compare this CSV");
    button.type = "button";
    button.addEventListener("click", () => chooseUploadedAndAnalyze(upload));
    section.append(button);
    sets.append(section);
  });
  $("dataset-dialog").showModal();
}

function setStatus(message, type = "") {
  const status = $("analysis-status");
  status.className = `analysis-status ${type}`.trim();
  status.textContent = message;
}
function resetLoaded() {
  state.detailActive = false;
  state.loaded = null;
  state.loadedSet = null;
  state.loadedSource = "";
  state.loadedUnit = "speaker";
  state.comparisonLoaded = null;
  state.comparisonSet = null;
  state.lastResult = null;
  state.linkedLoaded = null;
  ++state.linkedRequest;
  $("linked-results").hidden = true;
  $("linked-controls").hidden = true;
  $("comparison-evidence").hidden = true;
  $("focus-note").textContent = "Choose a measurement to set the comparison controls.";
  ++state.compareRequest;
  $("results").hidden = true;
  $("time-axis-wrap").hidden = true;
  $("contour-view-wrap").hidden = true;
  $("gamm-chart").hidden = true;
  ["condition-a", "condition-b", "condition-filter", "speaker-filter", "pair-filter", "context-filter", "context-b", "source-b"].forEach(id => { $(id).disabled = true; });
  $("context-b-wrap").hidden = true;
  $("run-button").disabled = true;
}
function populateSelect(select, values, firstLabel = null, preferred = null) {
  select.replaceChildren();
  if (firstLabel !== null) {
    const option = element("option", "", firstLabel);
    option.value = "";
    select.append(option);
  }
  values.forEach(value => { const option = element("option", "", value); option.value = value; select.append(option); });
  if (preferred !== null && [...select.options].some(option => option.value === preferred)) select.value = preferred;
  select.disabled = false;
}
function updateMode() {
  const kind = $("analysis-mode").value;
  $("template-link").href = kind === "duration" ? "./templates/duration.csv" : "./templates/f0.csv";
  $("template-link").download = kind === "duration" ? "duration.csv" : "f0.csv";
}
function updateTimeAxisControls() {
  const normalized = $("time-axis").value === "normalized";
  const timeMax = $("time-max");
  timeMax.hidden = normalized;
  timeMax.disabled = normalized;
  document.querySelector('label[for="time-max"]').hidden = normalized;
  $("time-axis-note").textContent = normalized
    ? "Only horizontal positions are rescaled. F0 stays in Hz; measured durations remain visible with the chart."
    : "Each contour keeps its measured duration, so longer vowels extend farther along the horizontal axis.";
}
function updateComparisonModes() {
  if (!state.loaded) return;
  const paired = boundPairComparison();
  const sameWord = sameWordConditions(state.loaded);
  const pairMode = $("compare-mode").querySelector('option[value="pair"]');
  pairMode.textContent = "Word pairs";
  pairMode.hidden = paired;
  pairMode.disabled = paired;
  document.querySelector('label[for="pair-filter"]').textContent = paired
    ? sameWord ? "Word (F vs NF within this word)" : "Minimal pair" : "Word pair";
  const contextsMode = $("compare-mode").querySelector('option[value="context"]');
  contextsMode.hidden = paired || state.loaded.kind === "f0";
  contextsMode.disabled = paired || state.loaded.kind === "f0";
  const unavailable = [];
  for (const option of $("compare-mode").options) {
    if (paired && ["context", "pair"].includes(option.value)) continue;
    if (["dataset", "linked", "context"].includes(option.value) && (option.value !== "context" || state.loaded.kind === "f0")) continue;
    option.disabled = levels(state.loaded.rows, option.value === "condition" ? "condition" : option.value).length < 2;
    if (option.disabled) unavailable.push(option.textContent);
  }
  if ($("compare-mode").selectedOptions[0]?.disabled) {
    $("compare-mode").value = [...$("compare-mode").options].find(option => !option.disabled)?.value || "dataset";
  }
  $("compare-mode-note").textContent = paired
    ? sameWord
      ? `Choose one recorded word. Compare its ${comparisonConditions(state.loaded.rows).join(" / ")} measurements within the same context; these are not labelled as lexical minimal pairs.`
      : `Choose one minimal pair. Conditions shows its ${comparisonConditions(state.loaded.rows).join(" / ")} groups; Speakers compares both conditions for each speaker. Datasets includes a complete pair from each source.`
    : unavailable.length
      ? `Unavailable within this measurement: ${unavailable.join(", ")}. To compare separate pair-specific tables, choose Datasets on one card.`
      : "Shared choices update each measurement where its recorded labels match; datasets stay separate.";
}
function showGroupControls(visible) {
  for (const id of ["group-a-label", "condition-a", "group-b-label", "condition-b"]) $(id).hidden = !visible;
}
function readDisplayControls() {
  const bound = id => {
    const raw = $(id).value.trim();
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${id} must be a number.`);
    if (["f0-min", "f0-max", "time-max"].includes(id) && value <= 0) throw new Error(`${id} must be greater than zero.`);
    return value;
  };
  const normalized = $("time-axis").value === "normalized";
  const controls = { f0Min: bound("f0-min"), f0Max: bound("f0-max"),
    timeMax: normalized ? null : bound("time-max"), timeAxis: normalized ? "normalized" : "actual",
    minimumTokens: Number($("minimum-tokens").value),
    showTraces: $("show-traces").checked };
  if (!Number.isInteger(controls.minimumTokens) || controls.minimumTokens < 1)
    throw new Error("Minimum tokens must be a positive whole number.");
  return controls;
}
function fillSecondSource() {
  const select = $("source-b");
  const previous = select.value;
  select.replaceChildren();
  const options = state.catalog.flatMap(dialect => dialect.measurementSets
    .filter(set => set.dataFile && set.kind === state.loaded?.kind && set.id !== state.loadedSet?.set.id)
    .map(set => ({ dialect, set })))
    .sort((a, b) => Number(b.dialect.id === state.activeDialectId) - Number(a.dialect.id === state.activeDialectId));
  options.forEach(({ dialect, set }) => {
    const option = element("option", "", `${dialect.title} · ${set.title}`);
    option.value = set.id;
    select.append(option);
  });
  if (options.some(item => item.set.id === previous)) select.value = previous;
  select.disabled = !options.length;
  return options.length;
}
function localFilteredRows() {
  if (!state.loaded) return [];
  const mode = $("compare-mode").value;
  const pair = mode === "pair" || mode === "speaker" ? "" : $("pair-filter").value;
  const context = mode === "context" ? "" : $("context-filter").value;
  const condition = $("condition-filter").value;
  return state.loaded.rows.filter(row => (!pair || row.pair === pair) && (!context || row.context === context)
    && (!condition || row.condition === condition));
}
function refreshBoundPairControls(preserve) {
  const rows = state.loaded.rows;
  const mode = $("compare-mode").value;
  const conditions = comparisonConditions(rows);
  const contextSelect = $("context-filter");
  const context = contextSelect.value || preferredContext(rows, state.loadedSet?.set);
  if (!contextSelect.value) contextSelect.value = context;
  contextSelect.hidden = false;
  document.querySelector('label[for="context-filter"]').hidden = false;
  document.querySelector('label[for="context-filter"]').textContent = "Context";
  $("context-b-wrap").hidden = true;
  $("source-b-wrap").hidden = true;
  $("condition-filter-wrap").hidden = true;
  $("speaker-filter-wrap").hidden = mode !== "condition";
  $("pair-filter").hidden = false;
  document.querySelector('label[for="pair-filter"]').hidden = false;
  showGroupControls(mode === "speaker");
  const first = $("condition-a"), second = $("condition-b");
  const oldA = preserve ? first.value : "", oldB = preserve ? second.value : "";
  const pairSelect = $("pair-filter"), previousPair = pairSelect.value;
  if (mode === "condition") {
    const speakers = levels(rows, "speaker");
    const speakerSelect = $("speaker-filter"), oldSpeaker = speakerSelect.value;
    const defaultSpeaker = speakers[0] || "";
    populateSelect(speakerSelect, speakers, "All speakers",
      preserve && oldSpeaker === "" ? "" : speakers.includes(oldSpeaker) ? oldSpeaker : defaultSpeaker);
    const pairs = completePairNames(rows, { speaker: speakerSelect.value, context, conditions,
      distinctWords: !sameWordConditions(state.loaded) });
    populateSelect(pairSelect, pairs, null, pairs.includes(previousPair) ? previousPair : pairs[0]);
    $("group-a-label").textContent = "Condition A";
    $("group-b-label").textContent = "Condition B";
    populateSelect(first, conditions, null, conditions[0]);
    populateSelect(second, conditions, null, conditions[1]);
    first.disabled = true;
    second.disabled = true;
    $("run-button").disabled = conditions.length !== 2 || !pairSelect.value;
  } else if (mode === "speaker") {
    const allSpeakers = levels(rows, "speaker");
    const pairs = comparablePairNames(rows, { context, conditions }).filter(pair =>
      allSpeakers.some((speakerA, index) => allSpeakers.slice(index + 1).some(speakerB =>
        sharedSpeakerPairs(rows, { speakerA, speakerB, context, conditions }).includes(pair))));
    populateSelect(pairSelect, pairs, null, pairs.includes(previousPair) ? previousPair : pairs[0]);
    const speakers = allSpeakers.filter(speakerA => allSpeakers.some(speakerB =>
      speakerA !== speakerB && sharedSpeakerPairs(rows, { speakerA, speakerB, context, conditions }).includes(pairSelect.value)));
    $("group-a-label").textContent = "Speaker A";
    $("group-b-label").textContent = "Speaker B";
    populateSelect(first, speakers, null, speakers.includes(oldA) ? oldA : speakers[0]);
    const secondSpeakers = speakers.filter(value => value !== first.value &&
      sharedSpeakerPairs(rows, { speakerA: first.value, speakerB: value, context, conditions }).includes(pairSelect.value));
    populateSelect(second, secondSpeakers, null, secondSpeakers.includes(oldB) ? oldB : secondSpeakers[0]);
    $("run-button").disabled = speakers.length < 2 || !pairSelect.value || !context;
  }
}
function refreshPairedDatasetControls(preserve) {
  showGroupControls(true);
  $("source-b-wrap").hidden = false;
  $("condition-filter-wrap").hidden = true;
  $("speaker-filter-wrap").hidden = true;
  $("pair-filter").hidden = true;
  document.querySelector('label[for="pair-filter"]').hidden = true;
  const firstContext = $("context-filter");
  firstContext.hidden = false;
  if (!firstContext.value) firstContext.value = preferredContext(state.loaded.rows, state.loadedSet?.set);
  document.querySelector('label[for="context-filter"]').hidden = false;
  document.querySelector('label[for="context-filter"]').textContent = "Context in first dataset";
  $("context-b-wrap").hidden = false;
  $("group-a-label").textContent = sameWordConditions(state.loaded)
    ? "Word in first dataset" : "Minimal pair in first dataset";
  $("group-b-label").textContent = sameWordConditions(state.comparisonLoaded)
    ? "Word in second dataset" : "Minimal pair in second dataset";
  const first = $("condition-a"), second = $("condition-b");
  const oldA = preserve ? first.value : "", oldB = preserve ? second.value : "";
  const secondContext = $("context-b");
  if (state.comparisonLoaded) {
    const contexts = levels(state.comparisonLoaded.rows, "context");
    const oldContext = preserve ? secondContext.value : "";
    populateSelect(secondContext, contexts, null, contexts.includes(oldContext)
      ? oldContext : matchingContext(state.comparisonLoaded.rows, state.comparisonSet?.set, firstContext.value));
  } else {
    populateSelect(secondContext, []);
    secondContext.disabled = true;
  }
  const fillPairs = (select, loaded, context, oldValue) => {
    const conditions = loaded ? comparisonConditions(loaded.rows) : [];
    const cells = loaded ? completePairedCells(loaded.rows, { context, conditions,
      distinctWords: !sameWordConditions(loaded) }) : [];
    const pairs = [...new Set(cells.map(cell => cell.pair))].sort((a, b) => a.localeCompare(b));
    populateSelect(select, pairs, null, pairs.includes(oldValue) ? oldValue : pairs[0]);
    for (const option of select.options) {
      const cell = cells.find(item => item.pair === option.value);
      if (cell) option.textContent = `${option.value} · ${conditions.map(condition => [...cell.words.get(condition).keys()][0]).join(" / ")}`;
    }
    select.disabled = !pairs.length;
    return pairs.length > 0;
  };
  const hasA = fillPairs(first, state.loaded, firstContext.value, oldA);
  const hasB = fillPairs(second, state.comparisonLoaded, secondContext.value, oldB);
  $("run-button").disabled = !hasA || !hasB || !state.comparisonLoaded;
}
function refreshGroupControls(preserve = true) {
  if (!state.loaded) return;
  const mode = $("compare-mode").value;
  if (mode === "linked") {
    $("linked-controls").hidden = false;
    showGroupControls(false);
    for (const id of ["source-b-wrap", "condition-filter-wrap", "speaker-filter-wrap", "context-b-wrap"]) $(id).hidden = true;
    $("pair-filter").hidden = true;
    $("context-filter").hidden = true;
    document.querySelector('label[for="pair-filter"]').hidden = true;
    document.querySelector('label[for="context-filter"]').hidden = true;
    $("run-button").disabled = !state.linkedLoaded;
    return;
  }
  $("linked-controls").hidden = true;
  if (pairedDataset()) {
    refreshPairedDatasetControls(preserve);
    return;
  }
  if (boundPairComparison() && ["condition", "speaker"].includes(mode)) {
    refreshBoundPairControls(preserve);
    return;
  }
  showGroupControls(true);
  const cross = mode === "dataset";
  $("source-b-wrap").hidden = !cross;
  $("context-b-wrap").hidden = !cross;
  document.querySelector('label[for="context-filter"]').textContent = cross ? "Context in first dataset" : "Context";
  const secondContext = $("context-b");
  if (cross && state.comparisonLoaded) {
    const contexts = levels(state.comparisonLoaded.rows, "context");
    const previousContext = secondContext.value;
    populateSelect(secondContext, contexts, null, contexts.includes(previousContext)
      ? previousContext : matchingContext(state.comparisonLoaded.rows, state.comparisonSet?.set, $("context-filter").value));
  } else if (cross) {
    populateSelect(secondContext, []);
    secondContext.disabled = true;
  }
  $("condition-filter-wrap").hidden = mode === "condition" || cross;
  $("speaker-filter-wrap").hidden = true;
  const hidePair = cross || mode === "pair" || mode === "speaker";
  if (hidePair) $("pair-filter").value = "";
  $("pair-filter").hidden = hidePair;
  document.querySelector('label[for="pair-filter"]').hidden = hidePair;
  const hideContext = mode === "context";
  if (hideContext) $("context-filter").value = "";
  $("context-filter").hidden = hideContext;
  document.querySelector('label[for="context-filter"]').hidden = hideContext;
  if (!hideContext && !$("context-filter").value)
    $("context-filter").value = preferredContext(state.loaded.rows, state.loadedSet?.set);
  const conditionFilter = $("condition-filter");
  if (conditionFilter.options.length) conditionFilter.options[0].disabled = mode === "speaker";
  if (mode === "speaker" && !conditionFilter.value) {
    const preferred = state.loadedSet?.set.defaultConditionA;
    conditionFilter.value = [...conditionFilter.options].some(option => option.value === preferred)
      ? preferred : conditionFilter.options[1]?.value || "";
  }
  const dimension = ["pair", "speaker", "context"].includes(mode) ? mode : "condition";
  const dimensionLabel = dimension === "pair" ? "Word pair" : `${dimension[0].toUpperCase()}${dimension.slice(1)}`;
  const primary = cross ? state.loaded.rows : mode === "condition"
    ? state.loaded.rows.filter(row => (!$('pair-filter').value || row.pair === $('pair-filter').value)
      && (!$('context-filter').value || row.context === $('context-filter').value)) : localFilteredRows();
  const secondary = cross ? state.comparisonLoaded?.rows || [] : primary;
  const valuesA = levels(primary, dimension), valuesB = levels(secondary, dimension);
  const oldA = preserve ? $("condition-a").value : null;
  const oldB = preserve ? $("condition-b").value : null;
  const defaultA = mode === "condition" ? state.loadedSet?.set.defaultConditionA : null;
  const defaultB = mode === "condition" ? state.loadedSet?.set.defaultConditionB : null;
  $("group-a-label").textContent = cross ? "Condition in first dataset" : `${dimensionLabel} A`;
  $("group-b-label").textContent = cross ? "Condition in second dataset" : `${dimensionLabel} B`;
  populateSelect($("condition-a"), valuesA, null, valuesA.includes(oldA) ? oldA : defaultA);
  populateSelect($("condition-b"), valuesB, null, valuesB.includes(oldB) ? oldB : defaultB);
  $("condition-a").disabled = !valuesA.length;
  $("condition-b").disabled = !valuesB.length;
  if (!cross && valuesB.length > 1 && $("condition-a").value === $("condition-b").value) {
    $("condition-b").value = valuesB.find(value => value !== $("condition-a").value);
  }
  $("run-button").disabled = !valuesA.length || !valuesB.length || (!cross && valuesA.length < 2)
    || (cross && !state.comparisonLoaded);
}
function placeFocusedResult(selected) {
  const output = document.querySelector(".analysis-output");
  const results = $("results");
  output.append(results);
  document.querySelectorAll(".overview-card[data-set-id]").forEach(card => {
    const focused = state.detailActive && card.dataset.setId === selected?.set.id;
    card.classList.toggle("is-focused", focused);
    const preview = card.querySelector(".overview-result");
    if (preview) preview.hidden = focused;
    const button = card.querySelector(".overview-focus-button");
    if (button) {
      button.setAttribute("aria-pressed", String(focused));
      button.hidden = focused;
    }
    if (focused) card.append(results);
  });
  if (!state.detailActive) {
    results.hidden = true;
  }
}
function showLoadedData(loaded, sourceLabel, selected = null, detailActive = true) {
  if (selected && selected.set.kind !== loaded.kind) throw new Error(`This selection expects ${selected.set.title.toLowerCase()} data.`);
  const keepShared = !!(state.loaded && selected && state.loadedSet?.dialect.id === selected.dialect.id);
  const previous = { mode: $("compare-mode").value, pair: $("pair-filter").value,
    context: $("context-filter").value, condition: $("condition-filter").value,
    speaker: $("speaker-filter").value };
  state.detailActive = detailActive;
  state.loaded = loaded;
  if (state.workspaceKind !== loaded.kind) {
    state.workspaceKind = loaded.kind;
    if (activeDialect()) renderLocalityOverview(activeDialect());
  }
  state.loadedSet = selected;
  state.loadedSource = sourceLabel;
  state.loadedUnit = selected?.set.analysisUnit || "speaker";
  $("focus-note").textContent = selected
    ? `Comparing ${selected.set.title}. Other measurements update where their recorded labels match.`
    : `Focused: ${sourceLabel}. This local CSV is held only in this page.`;
  state.comparisonLoaded = null;
  state.comparisonSet = null;
  $("compare-mode").value = keepShared && !["dataset", "linked"].includes(previous.mode) ? previous.mode : "condition";
  $("linked-results").hidden = true;
  $("locality-overview").hidden = false;
  updateComparisonModes();
  $("contour-view").value = "measured";
  $("analysis-mode").value = loaded.kind;
  updateMode();
  const initial = boundPairComparison()
    ? defaultPairedSelection(loaded.rows, selected?.set, !sameWordConditions(loaded)) : null;
  const contexts = levels(loaded.rows, "context");
  populateSelect($("context-filter"), contexts, null,
    keepShared && contexts.includes(previous.context) ? previous.context
      : initial?.context || preferredContext(loaded.rows, selected?.set));
  populateSelect($("speaker-filter"), levels(loaded.rows, "speaker"), "All speakers",
    keepShared ? previous.speaker : initial?.speaker || "");
  populateSelect($("pair-filter"), levels(loaded.rows, "pair"), boundPairComparison() ? null : "All word pairs",
    keepShared ? previous.pair : initial?.pair || selected?.set.defaultPair);
  populateSelect($("condition-filter"), levels(loaded.rows, "condition"), "All conditions", keepShared ? previous.condition : null);
  const anyF0 = visibleLocalityEntries().some(entry => entry.loaded?.kind === "f0");
  $("display-controls").hidden = !anyF0;
  $("time-axis-wrap").hidden = !anyF0;
  updateTimeAxisControls();
  fillSecondSource();
  refreshGroupControls(keepShared);
  placeFocusedResult(selected);
  runAnalysis();
}
async function loadIncludedSet(selected) {
  const response = await fetch(selected.set.dataFile, { cache: "no-store" });
  if (!response.ok) throw new Error(`Included data could not load (${response.status}).`);
  const parsed = parseCsv(await response.text());
  const loaded = selected.set.kind === "f0" ? normalizePhysicalF0(parsed) : normalizeCsv(parsed);
  return loaded;
}
function loadIncludedSetCached(selected) {
  const id = selected.set.id;
  if (!state.includedCache.has(id)) {
    state.includedCache.set(id, loadIncludedSet(selected).catch(error => {
      state.includedCache.delete(id);
      throw error;
    }));
  }
  return state.includedCache.get(id);
}
function sameContourDurations(loaded) {
  const tokens = new Map();
  loaded.rows.forEach(row => {
    if (!tokens.has(row.token)) tokens.set(row.token, {
      speaker: row.speaker, pair: row.pair, word: row.word, context: row.context,
      condition: row.condition, token: row.token, value: row.duration
    });
  });
  return { kind: "duration", profile: "Durations of the same F0 tokens", rows: [...tokens.values()],
    skipped: 0, reference: "milliseconds" };
}
function previewGroups(loaded, set, requestedContext = "") {
  const conditions = levels(loaded.rows, "condition");
  if (conditions.length < 2) return null;
  const contexts = levels(loaded.rows, "context");
  const context = contexts.includes(requestedContext) ? requestedContext : preferredContext(loaded.rows, set);
  if (!context) return null;
  const a = conditions.includes(set.defaultConditionA) ? set.defaultConditionA : conditions[0];
  const b = conditions.includes(set.defaultConditionB) && set.defaultConditionB !== a
    ? set.defaultConditionB : conditions.find(condition => condition !== a);
  const pair = completePairNames(loaded.rows, { context, conditions: [a, b],
    distinctWords: !sameWordConditions(loaded) })[0];
  if (!pair) return null;
  return [a, b].map(condition => ({ label: `${pair} · ${condition} · ${context}`,
    rows: loaded.rows.filter(row => row.condition === condition && row.context === context && row.pair === pair),
    intensityRows: loaded.intensityRows?.filter(row => row.condition === condition && row.context === context && row.pair === pair) || [] }));
}
function appendOverviewChart(card) {
  const result = element("div", "overview-result");
  card.append(result);
  return result;
}
function overviewElements(result) {
  result.replaceChildren();
  const header = element("div", "result-header");
  const title = element("h5");
  const profile = element("span", "profile-chip");
  header.append(title, profile);
  const kpis = element("div", "kpis");
  const chart = element("div", "chart-wrap");
  const summary = element("div", "table-wrap");
  const note = element("p", "result-note");
  result.append(header, kpis, chart, summary, note);
  return { titleNode: title, profileNode: profile, kpis, chart, summary, noteNode: note };
}
function sharedGroupsForEntry(entry, { mode, valueA, valueB, pair, context, condition, speaker, paired, conditions }) {
  const loaded = entry.loaded;
  if (mode === "dataset") return { groups: previewGroups(loaded, entry.selected.set, context),
    note: "The cross-dataset comparison is shown in the selected measurement; this card keeps its local condition comparison in one context." };
  if (!valueA || !valueB || valueA === valueB) return { groups: null, note: "Choose two different groups." };
  if (paired && speaker && !loaded.rows.some(row => row.speaker === speaker)) {
    return { groups: null,
      note: `${speaker} is not an ID in this measurement table. Choose Explore measurement to compare this table with its own speaker and pair controls.` };
  }
  if (paired && mode === "speaker") {
    if (![valueA, valueB].every(value => loaded.rows.some(row => row.speaker === value))) {
      return { groups: null,
        note: "This table uses different speaker IDs. Choose Explore measurement to compare its speakers and recorded long–overlong pairs." };
    }
    try {
      const { groups } = matchedSpeakerGroups(loaded.rows, loaded.intensityRows, {
        speakerA: valueA, speakerB: valueB, pair, context, conditions
      });
      return { groups, note: `Each speaker contributes both recorded conditions in ${pair} and ${context}.` };
    } catch (error) {
      return { groups: null, note: error.message };
    }
  }
  if (paired && mode === "condition") {
    const localConditions = comparisonConditions(loaded.rows);
    const localContext = levels(loaded.rows, "context").includes(context)
      ? context : preferredContext(loaded.rows, entry.selected.set);
    const localPairs = completePairNames(loaded.rows, { context: localContext,
      conditions: localConditions, distinctWords: !sameWordConditions(loaded) });
    const localPair = localPairs.includes(pair) ? pair : localPairs[0];
    const localSpeaker = speaker && loaded.rows.some(row => row.speaker === speaker) ? speaker : "";
    const groups = localPair ? conditionGroupsForPair(loaded, { pair: localPair, context: localContext,
      speaker: localSpeaker, conditions: localConditions }) : null;
    return { groups, note: `${localSpeaker || "All speakers"} · ${localPair || "No complete pair"} · ${localContext}. Each card keeps its own recorded pair.` };
  }
  const dimension = ["pair", "speaker", "context"].includes(mode) ? mode : "condition";
  const dimensionLabel = dimension === "pair" ? "Word pair" : `${dimension[0].toUpperCase()}${dimension.slice(1)}`;
  const values = levels(loaded.rows, dimension);
  if (mode === "condition" && !pair && !context && (!values.includes(valueA) || !values.includes(valueB))) {
    return { groups: previewGroups(loaded, entry.selected.set, context),
      note: "This sample uses its own recorded condition labels, shown in the chart title." };
  }
  const rows = loaded.rows.filter(row => (!pair || row.pair === pair) && (!context || row.context === context)
    && (!speaker || row.speaker === speaker)
    && ((mode === "condition") || !condition || row.condition === condition));
  const intensityRows = (loaded.intensityRows || []).filter(row => (!pair || row.pair === pair)
    && (!context || row.context === context) && (!speaker || row.speaker === speaker)
    && ((mode === "condition") || !condition || row.condition === condition));
  const groups = [valueA, valueB].map(value => ({
    label: `${dimensionLabel} ${value}`,
    rows: rows.filter(row => row[dimension] === value),
    intensityRows: intensityRows.filter(row => row[dimension] === value)
  }));
  return { groups, note: "" };
}
function renderOtherCards(filters, controls) {
  const activeId = state.loadedSet?.set.id;
  for (const entry of visibleLocalityEntries()) {
    if (!entry.loaded || (state.detailActive && entry.selected.set.id === activeId)) continue;
    const card = [...document.querySelectorAll(".overview-card[data-set-id]")]
      .find(item => item.dataset.setId === entry.selected.set.id);
    const result = card?.querySelector(".overview-result");
    if (!result) continue;
    result.hidden = false;
    const { groups, note } = sharedGroupsForEntry(entry, filters);
    if (!groups || groups.some(group => !group.rows.length)) {
      const detail = note || "Its recorded group labels or filters do not match the current selection.";
      result.replaceChildren(element("p", "overview-disconnected", detail));
      continue;
    }
    const elements = overviewElements(result);
    try {
      renderPhysicalComparison({ kind: entry.loaded.kind, groups, controls,
        title: filters.paired && filters.mode === "speaker"
          && [filters.valueA, filters.valueB].every(value => entry.loaded.rows.some(row => row.speaker === value))
          ? `${filters.valueA} vs ${filters.valueB} · ${filters.pair} · ${filters.context}`
          : `${groups[0].label} vs ${groups[1].label}`,
        note: [entry.selected.set.timeBasis || entry.selected.set.method || "", note].filter(Boolean).join(" "),
        elements });
    } catch (error) {
      result.replaceChildren(element("p", "overview-unavailable", error.message || "This comparison could not be drawn."));
    }
  }
}
function renderLocalityOverview(dialect) {
  const grid = $("overview-grid");
  document.querySelector(".analysis-output").append($("results"));
  grid.replaceChildren();
  $("locality-overview").hidden = false;
  $("overview-title").textContent = dialect.title;
  $("overview-note").textContent = dialect.id === "leer-low-german"
    ? state.workspaceKind === "duration"
      ? "Vowel length is the primary comparison. Supplementary F0 measurements are available in the contrast profile; their speaker IDs use a separate system."
      : "F0 and the displayed vowel durations share the same measured tokens. The independent duration table uses separate speaker IDs."
    : "Choose a measurement to compare its recorded groups.";
  const leerDurationIds = ["leer-f0-token-duration", "leer-duration"];
  visibleLocalityEntries().filter(entry => dialect.id !== "leer-low-german" || entry.upload
    || !leerDurationIds.includes(entry.selected.set.id)
    || entry.selected.set.id === state.durationEntryId).forEach(entry => {
    const { selected, loaded, error, derived } = entry;
    const card = element("article", entry.upload ? "overview-card overview-upload" : "overview-card");
    card.dataset.setId = selected.set.id;
    const header = element("div", "overview-card-head");
    const heading = element("div");
    heading.append(element("span", selected.set.kind === "f0" ? "contour-tag" : "duration-tag",
      `${entry.upload ? "LOCAL " : ""}${selected.set.kind === "f0" ? "F0 · Hz" : "DURATION · MS"}`));
    const isLeerDuration = dialect.id === "leer-low-german" && leerDurationIds.includes(selected.set.id);
    heading.append(element("h4", "", isLeerDuration ? "Vowel duration" : selected.set.title));
    header.append(heading);
    card.append(header);
    card.append(element("p", "overview-description", isLeerDuration
      ? derived
        ? "One measured duration per F0 contour token; duration and F0 share token IDs."
        : "The larger duration table adds contexts. Its speaker IDs use a different system from the F0 contours."
      : selected.set.summary));
    if (error) {
      card.append(element("p", "overview-unavailable", `Included measurements could not load: ${error.message || error}`));
    } else {
      const actions = element("div", "overview-actions");
      const button = element("button", "quiet-button overview-focus-button", "Explore measurement");
      button.type = "button";
      button.addEventListener("click", () => {
        showLoadedData(loaded, entry.upload ? "Your local CSV" : "Included local data", selected);
        const destination = $("results").hidden ? $("analysis-status") : $("result-title");
        destination.focus({ preventScroll: true });
        destination.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      actions.append(button);
      header.append(actions);
      grid.append(card);
      appendOverviewChart(card);
      return;
    }
    grid.append(card);
  });
}
async function onSourceChange(preferredSetId = null) {
  const request = ++state.loadRequest;
  resetLoaded();
  $("file-input").value = "";
  const dialect = activeDialect();
  $("custom-data-panel").open = false;
  $("analysis-mode").disabled = false;
  if (!dialect) { setStatus("Choose a dialect."); return; }
  renderWorkspaceProfile(dialect);
  $("locality-overview").hidden = false;
  $("overview-title").textContent = dialect.title;
  $("overview-note").textContent = "Loading all included measurements…";
  document.querySelector(".analysis-output").append($("results"));
  $("overview-grid").replaceChildren();
  $("source-note").textContent = "";
  setStatus("Loading included measurements…");
  const selections = orderedSets(dialect).filter(set => set.dataFile).map(set => ({ dialect, set }));
  const entries = await Promise.all(selections.map(async selected => {
    try { return { selected, loaded: await loadIncludedSetCached(selected) }; }
    catch (error) { return { selected, error }; }
  }));
  if (request !== state.loadRequest) return;
  state.localityEntries = entries;
  const contourSource = entries.find(entry => entry.selected.set.kind === "f0" && entry.loaded);
  if (contourSource) {
    const derived = sameContourDurations(contourSource.loaded);
    state.localityEntries.push({ selected: { dialect, set: {
      id: `${contourSource.selected.set.id}-token-duration`, kind: "duration", title: "Vowel duration in the F0 sample",
      summary: "Measured vowel durations for the tokens whose F0 contours appear here.",
      defaultConditionA: contourSource.selected.set.defaultConditionA,
      defaultConditionB: contourSource.selected.set.defaultConditionB,
      timeBasis: "Durations and F0 contours come from the same token IDs in this measurement source." } },
      loaded: derived, derived: true });
  }
  const linkedDuration = state.localityEntries.find(entry => entry.loaded && entry.derived);
  const broadDuration = state.localityEntries.find(entry => entry.loaded && entry.selected.set.id === "leer-duration");
  const preferred = state.localityEntries.find(entry => entry.loaded && entry.selected.set.id === preferredSetId)
    || state.localityEntries.find(entry => entry.loaded);
  state.workspaceKind = preferred?.loaded.kind || dialect.typology?.preferredMeasurement;
  state.durationEntryId = dialect.id === "leer-low-german"
    ? state.workspaceKind === "duration" && broadDuration ? "leer-duration"
      : linkedDuration?.selected.set.id || broadDuration?.selected.set.id || null
    : null;
  uploadsForDialect(dialect).forEach(upload => state.localityEntries.push(entryForUpload(upload)));
  renderLocalityOverview(dialect);
  const focus = state.localityEntries.find(entry => entry.loaded && entry.selected.set.id === preferredSetId)
    || state.localityEntries.find(entry => entry.loaded);
  if (focus) {
    showLoadedData(focus.loaded, focus.upload ? "Your local CSV" : "Included local data", focus.selected, true);
  } else {
    setStatus("No included measurements for this locality could be read. Open a compatible CSV below.", "error");
    $("custom-data-panel").open = true;
  }
}
async function onFileChange() {
  const request = ++state.loadRequest;
  const target = state.uploadTarget;
  const file = $("file-input").files?.[0];
  if (!file) { setStatus("No CSV selected; the current measurements remain available."); return; }
  if (file.size > 10 * 1024 * 1024) { setStatus("File is larger than 10 MB. Choose a smaller CSV.", "error"); return; }
  try {
    const parsed = parseCsv(await file.text());
    if (request !== state.loadRequest) return;
    const loaded = $("analysis-mode").value === "f0" ? normalizePhysicalF0(parsed) : normalizeCsv(parsed);
    resetLoaded();
    const dialect = target?.dialect || activeDialect();
    if (!dialect) throw new Error("Choose a dialect for this CSV.");
    const sourceLabel = `${dialect.title} · ${file.name}`;
    $("source-note").textContent = `${sourceLabel} is available in this panel until the page is reloaded.`;
    const upload = { dialect, kind: loaded.kind, loaded, label: sourceLabel, fileName: file.name };
    const entry = entryForUpload(upload);
    state.sessionUploads.set(`${dialect.id}:${loaded.kind}`, upload);
    state.localityEntries = state.localityEntries.filter(item => item.selected.set.id !== entry.selected.set.id);
    state.localityEntries.push(entry);
    renderLocalityOverview(dialect);
    renderCatalog();
    showLoadedData(loaded, sourceLabel, entry.selected);
  } catch (error) {
    if (request !== state.loadRequest) return;
    setStatus(error.message || "This CSV could not be read.", "error");
  }
}
async function onSecondarySourceChange() {
  const request = ++state.compareRequest;
  state.comparisonLoaded = null;
  state.comparisonSet = null;
  $("results").hidden = true;
  const selected = findSet($("source-b").value);
  if (!selected?.set.dataFile || selected.set.kind !== state.loaded?.kind) {
    $("compare-mode").value = "condition";
    refreshGroupControls(false);
    runAnalysis();
    setStatus("Choose a second dataset with the same measurement type. The local comparison is shown instead.", "error");
    return;
  }
  setStatus("Loading the second dataset…");
  try {
    const loaded = await loadIncludedSetCached(selected);
    if (request !== state.compareRequest) return;
    state.comparisonLoaded = loaded;
    state.comparisonSet = selected;
    refreshGroupControls(false);
    runAnalysis();
  } catch (error) {
    if (request !== state.compareRequest) return;
    $("compare-mode").value = "condition";
    refreshGroupControls(false);
    runAnalysis();
    setStatus(`${error.message || "The second dataset could not be read."} The local comparison is shown instead.`, "error");
  }
}
function linkedContextOptions(entry) {
  const conditions = comparisonConditions(entry.loaded.rows);
  const contexts = levels(entry.loaded.rows.filter(row => row.pair === entry.member.pair), "context");
  return contexts.filter(context => completePairedCells(entry.loaded.rows, { context, conditions,
    distinctWords: !sameWordConditions(entry.loaded) }).some(cell => cell.pair === entry.member.pair));
}
function linkedSpeakerOptions(entry, context) {
  const conditions = comparisonConditions(entry.loaded.rows);
  return [...new Set(completePairedCells(entry.loaded.rows, { context, conditions,
    distinctWords: !sameWordConditions(entry.loaded) })
    .filter(cell => cell.pair === entry.member.pair).map(cell => cell.key && JSON.parse(cell.key)[0]))].sort();
}
function linkedContextChoices(linked) {
  const [first, second] = linked.entries;
  const contextsA = linkedContextOptions(first), contextsB = linkedContextOptions(second);
  if (!contextsA.length || !contextsB.length) throw new Error("No complete recorded pair is available for this word alignment.");
  if (linked.spec.contextSelection === "first-source-only") {
    if (contextsB.length !== 1) throw new Error("The second source has multiple unmatched contexts; this alignment needs an explicit context mapping.");
    return contextsA.map(context => ({ id: context, label: context, recorded: [context, contextsB[0]] }));
  }
  const choices = (linked.spec.contexts || []).filter(choice =>
    contextsA.includes(choice.recorded[0]) && contextsB.includes(choice.recorded[1]));
  if (!choices.length) throw new Error("These dialects have no verified shared context choice for this pair.");
  return choices;
}
function selectedLinkedContext(side) {
  const linked = state.linkedLoaded;
  return linked?.contextChoices?.find(choice => choice.id === $("linked-context").value)?.recorded[side] || "";
}
function updateLinkedSpeaker(side, preserve = true) {
  const entry = state.linkedLoaded?.entries[side];
  if (!entry) return;
  const context = selectedLinkedContext(side);
  const select = $(side ? "linked-speaker-b" : "linked-speaker-a");
  const speakers = linkedSpeakerOptions(entry, context);
  const previous = preserve ? select.value : "";
  const isWorkbook = entry.selected.set.analysisUnit === "speaker-coded series";
  populateSelect(select, speakers, isWorkbook ? "All workbook series (mean)" : "All speakers (mean)",
    preserve && previous === "" ? "" : speakers.includes(previous) ? previous : speakers[0]);
  $(side ? "linked-speaker-b-label" : "linked-speaker-a-label").textContent =
    `${isWorkbook ? "Workbook series" : "Speaker"} in ${entry.selected.dialect.title}`;
}
function populateLinkedControls() {
  const linked = state.linkedLoaded;
  const entries = linked?.entries;
  if (!entries) return;
  const [first, second] = entries;
  linked.contextChoices = linkedContextChoices(linked);
  const select = $("linked-context");
  const previous = select.value;
  const preferred = preferredContext(first.loaded.rows, first.selected.set);
  select.replaceChildren();
  linked.contextChoices.forEach(choice => {
    const option = element("option", "", choice.label);
    option.value = choice.id;
    select.append(option);
  });
  const initial = linked.contextChoices.find(choice => choice.id === previous)
    || linked.contextChoices.find(choice => choice.recorded[0] === preferred)
    || linked.contextChoices[0];
  select.value = initial.id;
  select.disabled = false;
  $("linked-context-note").textContent = linked.spec.contextSelection === "first-source-only"
    ? `${first.selected.dialect.title} changes with this choice; ${second.selected.dialect.title} has only one recorded workbook context, which is not verified as equivalent.`
    : `One sentence type and position choice maps to each dialect's recorded label. Focus is not matched across these sources.`;
  updateLinkedSpeaker(0, false);
  updateLinkedSpeaker(1, false);
  $("run-button").disabled = false;
}
async function onLinkedSetChange() {
  const request = ++state.linkedRequest;
  state.linkedLoaded = null;
  $("linked-results").hidden = true;
  $("run-button").disabled = true;
  const spec = linkedWordSets.find(item => item.id === $("linked-set").value);
  if (!spec) { setStatus("Choose an etymology word pair.", "error"); return; }
  const selected = spec.members.map(member => findSet(member.setId));
  if (selected.some(item => !item?.set.dataFile)) { setStatus("A linked measurement source is unavailable.", "error"); return; }
  setStatus("Loading the two local measurements…");
  try {
    const loaded = await Promise.all(selected.map(item => loadIncludedSetCached(item)));
    if (request !== state.linkedRequest || $("compare-mode").value !== "linked") return;
    state.linkedLoaded = { spec, entries: selected.map((item, index) => ({
      selected: item, loaded: loaded[index], member: spec.members[index]
    })) };
    $("linked-context").replaceChildren();
    populateLinkedControls();
    const hasF0 = loaded.some(item => item.kind === "f0");
    $("time-axis-wrap").hidden = !hasF0;
    $("display-controls").hidden = !hasF0;
    updateTimeAxisControls();
    $("display-note").textContent = "Sparse-bin cutoff and chart ranges change the measured F0 views; source measurements are unchanged. Set the minimum to 1 to show every observed mean point.";
    runLinkedAnalysis();
  } catch (error) {
    if (request !== state.linkedRequest) return;
    state.linkedLoaded = null;
    setStatus(error.message || "The linked measurements could not be loaded.", "error");
  }
}
function linkedDurationGroups(groups) {
  return groups.map(group => {
    const tokens = new Map();
    group.rows.forEach(row => {
      if (!tokens.has(row.token)) tokens.set(row.token, { ...row, value: row.duration });
    });
    return { ...group, rows: [...tokens.values()], intensityRows: [] };
  });
}
function appendLinkedPlot(panel, kind, groups, controls, title, note, speakerBalancedDuration = false) {
  const chart = element("div", "chart-wrap linked-chart");
  panel.append(chart);
  const titleNode = element("h4"), profileNode = element("span"), kpis = element("div"),
    summary = element("div"), noteNode = element("p");
  renderPhysicalComparison({ kind, groups, controls, title, note, speakerBalancedDuration,
    elements: { titleNode, profileNode, kpis, chart, summary, noteNode } });
  return chart;
}
function renderCurrentEvidence(groups, mode, datasetPaired) {
  const host = $("comparison-evidence");
  host.replaceChildren();
  if (!boundPairComparison() || !["condition", "speaker", "dataset"].includes(mode)) {
    host.hidden = true;
    return;
  }
  const blocks = datasetPaired
    ? [0, 1].map(index => ({ groups: groups.filter(group => group.comparisonIndex === index),
      selected: index ? state.comparisonSet : state.loadedSet }))
    : mode === "speaker"
      ? [0, 1].map(index => ({ groups: groups.filter(group => group.comparisonIndex === index), selected: state.loadedSet }))
      : [{ groups, selected: state.loadedSet }];
  blocks.filter(block => block.groups.length === 2).forEach(block => {
    const first = block.groups[0].rows[0];
    const speakers = [...new Set(block.groups.flatMap(group => group.rows.map(row => row.speaker)))].sort();
    host.append(renderEvidenceCard({
      title: block.selected?.dialect.title || "Local CSV",
      pair: first.pair,
      speaker: speakers.join(", "),
      context: first.context,
      kind: block.selected?.set.kind || state.loaded.kind,
      groups: block.groups,
      source: block.selected?.set.title || state.loadedSource,
      note: "The chart uses this one recorded context; source condition labels and token counts are kept separate."
    }));
  });
  host.hidden = !host.children.length;
}
function renderGammMeasuredReference(groups, mode, datasetPaired, modelLabel, context) {
  renderCurrentEvidence(groups, mode, datasetPaired);
  const host = $("comparison-evidence");
  for (const card of host.querySelectorAll(".evidence-card")) {
    card.querySelector(".eyebrow").textContent = "MEASURED DATA REFERENCE";
    const note = card.querySelector(".evidence-note");
    if (note) note.textContent = `These tokens and cues belong to the selected measured pair and speaker. The ${modelLabel} pools its source speakers and word pairs within ${context}; only the context selection changes the displayed model prediction. These counts are not the model sample size.`;
  }
}
function runLinkedAnalysis() {
  const linked = state.linkedLoaded;
  if (!linked) return;
  const host = $("linked-results");
  try {
    const controls = readDisplayControls();
    const selections = linked.entries.map((entry, index) => {
      const context = selectedLinkedContext(index);
      const conditions = comparisonConditions(entry.loaded.rows);
      const speaker = $(index ? "linked-speaker-b" : "linked-speaker-a").value;
      const allSpeakers = !speaker;
      const availableSpeakers = linkedSpeakerOptions(entry, context);
      const speakers = allSpeakers ? availableSpeakers : [speaker];
      if (!context || !speakers.length || speakers.some(id => !availableSpeakers.includes(id)) || conditions.length !== 2)
        throw new Error("Choose one context and a complete speaker or workbook series in each dialect.");
      const recordedGroups = conditionGroupsForPair(entry.loaded, { pair: entry.member.pair, context, speaker, conditions })
        .map(group => {
          const { condition, word } = group.rows[0] || {};
          return { ...group, label: condition === word ? word : `${condition} · ${word}` };
        });
      if (recordedGroups.some(group => !group.rows.length))
        throw new Error(`${entry.selected.dialect.title} has no complete pair in ${context} for this selection.`);
      const groups = orderLinkedGroups(linked.spec, index, recordedGroups);
      return { ...entry, context, speaker, speakers, allSpeakers, groups };
    });
    host.replaceChildren();
    const heading = element("div", "linked-heading");
    heading.append(element("p", "eyebrow", "ETYMOLOGY WORD PAIRS"),
      element("h3", "", linked.spec.title), element("p", "", linked.spec.status));
    const alignments = element("div", "linked-alignments");
    linked.spec.alignments.forEach(item => {
      const link = element("div", "linked-alignment");
      link.append(element("strong", "", `${item.forms[0]} ↔ ${item.forms[1]}`),
        element("span", "", item.gloss));
      alignments.append(link);
    });
    heading.append(alignments);
    host.append(heading);
    const grid = element("div", "linked-grid");
    host.append(grid);
    host.hidden = false;
    selections.forEach(item => {
      const panel = element("article", "linked-source overview-card");
      grid.append(panel);
      const isWorkbook = item.selected.set.analysisUnit === "speaker-coded series";
      const unit = isWorkbook ? "workbook series" : "speakers";
      const speakerSummary = item.allSpeakers ? `${item.speakers.length} ${unit}: ${item.speakers.join(", ")}` : item.speaker;
      const allNote = item.allSpeakers
        ? `All ${unit} have both words in this recorded context. ${item.loaded.kind === "f0" ? "F0 bin means give each speaker equal weight. " : ""}Duration's thick line is the equal-weight mean of per-ID means. Duration dots and medians are measured tokens.`
        : "";
      panel.append(renderEvidenceCard({ title: item.selected.dialect.title,
        pair: item.member.pair, speaker: speakerSummary, context: item.context,
        kind: item.loaded.kind, groups: item.groups, source: item.selected.set.title,
        note: `${item.member.lexicalNote}${allNote ? ` ${allNote}` : ""}` }));
      appendLinkedPlot(panel, item.loaded.kind, item.groups, controls,
        item.loaded.kind === "f0" ? "F0 contours" : "Vowel duration",
        "Observed measurements from complete speaker or workbook-series pairs in this context only.",
        item.allSpeakers && item.loaded.kind === "duration");
      if (item.loaded.kind === "f0") appendLinkedPlot(panel, "duration", linkedDurationGroups(item.groups), controls,
        "Vowel duration of these F0 tokens",
        "The duration plot uses the same token IDs as the F0 plot above; it is not the independent duration table.",
        item.allSpeakers);
    });
    host.append(element("p", "linked-caveat", `${linked.spec.contextNote} Each dialect keeps its own condition labels, speaker or series IDs, units, and axes. Means combine complete IDs only within a selected dialect and context; no F0 curves or token means are pooled across dialects.`));
    $("locality-overview").hidden = true;
    $("results").hidden = true;
    setStatus(`Etymology comparison ready: ${linked.spec.shortTitle}.`, "success");
  } catch (error) {
    host.hidden = true;
    setStatus(error.message || "The linked comparison could not be displayed.", "error");
  }
}
async function onCompareModeChange() {
  if (!state.loaded) return;
  if ($("compare-mode").value === "linked") {
    if (!state.linkedLoaded && state.activeDialectId === "baden-low-german") $("linked-set").value = "side-silk";
    $("locality-overview").hidden = true;
    $("results").hidden = true;
    $("focus-note").textContent = "Each dialect uses one recorded pair and context; choose one ID or its complete speaker or series mean.";
    $("compare-mode-note").textContent = "One context choice maps to each source where comparable labels are recorded; each dialect keeps its own condition names.";
    refreshGroupControls(false);
    await onLinkedSetChange();
    return;
  }
  ++state.linkedRequest;
  $("linked-results").hidden = true;
  $("locality-overview").hidden = false;
  $("focus-note").textContent = `Comparing ${state.loadedSet?.set.title || "the focused measurement"}. Other measurements update where their recorded labels match.`;
  updateComparisonModes();
  if ($("compare-mode").value === "dataset") {
    if (!fillSecondSource()) {
      setStatus("No second dataset of this measurement type is included.", "error");
      refreshGroupControls(false);
      return;
    }
    if (!state.detailActive) {
      state.detailActive = true;
      placeFocusedResult(state.loadedSet);
      $("focus-note").textContent = `Cross-dataset comparison is shown in ${state.loadedSet?.set.title || "the selected measurement"}; other cards keep their separate local samples.`;
    }
    await onSecondarySourceChange();
  } else {
    ++state.compareRequest;
    state.comparisonLoaded = null;
    state.comparisonSet = null;
    refreshGroupControls(false);
    runAnalysis();
  }
}

function availableGamm({ mode, pair, context, valueA, valueB }, models = state.gammModels, name = "Original") {
  if (state.loaded?.kind !== "f0") return { reason: "GAMM contours are available for F0 data only." };
  const key = gammSetKeys[state.loadedSet?.set.id];
  if (!key) return { reason: "The original GAMM is available only for the included Leer and Aachen F0 datasets." };
  const model = models?.[key];
  if (!model) return { reason: `${name} GAMM predictions could not be loaded; measured contours remain available.` };
  if (mode !== "condition") return { reason: `Choose Compare: Conditions to view the ${name.toLowerCase()} GAMM.` };
  if (!model.conditions?.includes(valueA) || !model.conditions?.includes(valueB))
    return { reason: `These conditions are not in the ${name.toLowerCase()} GAMM.` };
  if (context && !model.contexts?.includes(context))
    return { reason: `This context is not in the ${name.toLowerCase()} GAMM.` };
  return { model };
}

function runAnalysis() {
  if (!state.loaded) return;
  if ($("compare-mode").value === "linked") { runLinkedAnalysis(); return; }
  document.querySelectorAll(".focused-error").forEach(node => node.remove());
  try {
    const mode = $("compare-mode").value;
    const paired = boundPairComparison() && ["condition", "speaker"].includes(mode);
    const datasetPaired = pairedDataset();
    const conditions = paired ? comparisonConditions(state.loaded.rows) : [];
    const valueA = $("condition-a").value, valueB = $("condition-b").value;
    if (["pair", "speaker", "context"].includes(mode) && levels(state.loaded.rows, mode).length < 2) {
      const name = mode === "pair" ? "word pair" : mode;
      throw new Error(`This measurement has only one ${name}. Choose another card, or compare compatible datasets.`);
    }
    if (!valueA || !valueB) throw new Error(datasetPaired
      ? "Both datasets need a complete two-condition comparison in their chosen contexts."
      : "Choose two comparison groups.");
    if (mode !== "dataset" && valueA === valueB) throw new Error("Choose two different groups.");
    if (mode === "dataset" && !state.comparisonLoaded) throw new Error("Choose and load a second dataset.");
    const pair = mode === "pair" || mode === "dataset" ? "" : $("pair-filter").value;
    const context = mode === "context" ? "" : $("context-filter").value;
    const secondContext = mode === "dataset" ? $("context-b").value : "";
    const condition = paired ? "" : $("condition-filter").value;
    const speaker = paired && mode === "condition" ? $("speaker-filter").value : "";
    if (mode !== "context" && !context) throw new Error("Choose one context for this comparison.");
    if (mode === "dataset" && !secondContext) throw new Error("Choose one context in each dataset.");
    if (paired && ["condition", "speaker"].includes(mode) && !pair) throw new Error("Choose one complete recorded pair or word.");
    if (paired && mode === "speaker" && !context) throw new Error("Choose one context shared by both speakers.");
    const sharedFilters = { mode, valueA, valueB, pair, context, condition, speaker, paired, conditions };
    const controls = readDisplayControls();
    const localFilter = row => (!pair || row.pair === pair) && (!context || row.context === context)
      && (!speaker || row.speaker === speaker)
      && (mode === "condition" || !condition || row.condition === condition);
    const dimension = ["pair", "speaker", "context"].includes(mode) ? mode : "condition";
    const dimensionLabel = dimension === "pair" ? "Word pair" : `${dimension[0].toUpperCase()}${dimension.slice(1)}`;
    const primaryLabel = state.loadedSet ? `${state.loadedSet.dialect.title} · ${state.loadedSet.set.title}` : state.loadedSource || "Your CSV";
    const secondaryLabel = state.comparisonSet
      ? `${state.comparisonSet.dialect.title} · ${state.comparisonSet.set.title}` : "Second dataset";
    const pairedMatch = paired && mode === "speaker"
      ? matchedSpeakerGroups(state.loaded.rows, state.loaded.intensityRows, {
        speakerA: valueA, speakerB: valueB, pair, context, conditions
      })
      : null;
    const datasetGroups = datasetPaired ? [
      { loaded: state.loaded, selected: state.loadedSet, pair: valueA, context, comparisonIndex: 0 },
      { loaded: state.comparisonLoaded, selected: state.comparisonSet, pair: valueB,
        context: secondContext, comparisonIndex: 1 }
    ].flatMap(({ loaded, selected, pair: chosenPair, context: chosenContext, comparisonIndex }) => {
      const labels = comparisonConditions(loaded.rows);
      if (labels.length !== 2) throw new Error("Each dataset needs exactly two recorded conditions.");
      const comparisonLabel = selected?.dialect.title || `Dataset ${comparisonIndex + 1}`;
      return conditionGroupsForPair(loaded, { pair: chosenPair, context: chosenContext, conditions: labels })
        .map((group, conditionIndex) => ({ ...group,
          label: `${comparisonLabel} · ${group.label}`,
          comparisonIndex, comparisonLabel, condition: labels[conditionIndex],
          pair: chosenPair, context: chosenContext }));
    }) : null;
    const groups = datasetPaired ? datasetGroups : mode === "dataset" ? [
      { label: `${primaryLabel} · ${valueA} · ${context}`,
        rows: state.loaded.rows.filter(row => row.condition === valueA && row.context === context),
        intensityRows: state.loaded.intensityRows?.filter(row => row.condition === valueA && row.context === context) || [] },
      { label: `${secondaryLabel} · ${valueB} · ${secondContext}`,
        rows: state.comparisonLoaded.rows.filter(row => row.condition === valueB && row.context === secondContext),
        intensityRows: state.comparisonLoaded.intensityRows?.filter(row => row.condition === valueB && row.context === secondContext) || [] }
    ] : pairedMatch ? pairedMatch.groups
      : paired && mode === "condition" ? conditionGroupsForPair(state.loaded, { pair, context, speaker, conditions })
        : [valueA, valueB].map(value => ({
      label: `${dimensionLabel} ${value}`,
      rows: state.loaded.rows.filter(row => localFilter(row) && row[dimension] === value),
      intensityRows: state.loaded.intensityRows?.filter(row => localFilter(row) && row[dimension] === value) || []
    }));
    if (groups.some(group => !group.rows.length)) throw new Error(datasetPaired
      ? "Each source needs both measured conditions in its selected pair or word and context."
      : "Both comparison groups need measured records.");
    const gamm = availableGamm({ mode, pair, context, valueA, valueB });
    const physicalGamm = availableGamm({ mode, pair, context, valueA, valueB },
      state.physicalGammModels, "Physical-time");
    const isF0 = state.loaded.kind === "f0";
    $("contour-view-wrap").hidden = !isF0 || !state.detailActive || (!gamm.model && !physicalGamm.model);
    for (const [value, model] of [["gamm", gamm.model], ["gamm-physical", physicalGamm.model]]) {
      const option = $("contour-view").querySelector(`option[value="${value}"]`);
      option.disabled = !model; option.hidden = !model;
    }
    const selectedView = $("contour-view").value;
    $("contour-view-note").textContent = selectedView === "gamm-physical"
      ? "This new exploratory GAMM is fitted to measured milliseconds and Hz; each curve ends at its condition's observed median vowel duration. Speaker and pair filters do not refit it."
      : gamm.model
        ? "The original model pools its source speakers and word pairs; only the context choice applies. Its curves use normalized time and semitones. A separate site-table duration summary uses measured milliseconds."
        : gamm.reason;
    if (!gamm.model && $("contour-view").value === "gamm") $("contour-view").value = "measured";
    if (!physicalGamm.model && $("contour-view").value === "gamm-physical") $("contour-view").value = "measured";
    $("contour-view-note").hidden = gamm.model || physicalGamm.model
      ? $("contour-view").value === "measured"
      : !gammSetKeys[state.loadedSet?.set.id];
    if (state.detailActive && isF0 && physicalGamm.model && $("contour-view").value === "gamm-physical") {
      $("chart").hidden = true;
      $("gamm-chart").hidden = false;
      $("kpis").hidden = true;
      $("summary-table").hidden = true;
      const anyF0 = visibleLocalityEntries().some(entry => entry.loaded?.kind === "f0");
      $("time-axis-wrap").hidden = !anyF0;
      $("display-controls").hidden = !anyF0;
      $("time-axis-note").textContent = "The physical-time GAMM uses measured milliseconds. This setting applies to the measured F0 cards in the workspace.";
      $("display-note").textContent = "Chart display settings apply to measured F0 cards; this new GAMM has its own fitted Hz scale and intervals.";
      $("result-title").textContent = `${physicalGamm.model.conditions.join(" vs ")} · physical-time GAMM`;
      $("result-profile").textContent = "Fitted Hz · measured ms";
      renderPhysicalTimeGammView({ container: $("gamm-chart"), model: physicalGamm.model, context });
      renderGammMeasuredReference(groups, mode, datasetPaired, "physical-time GAMM", context);
      $("result-note").textContent = "This is a new exploratory GAMM refit of the included physical-time F0 measurements, separate from the original research model. It fits F0 in Hz through a log transform on measured elapsed milliseconds. Different curve endpoints show observed median vowel durations, not model-predicted durations.";
      state.lastResult = { kind: "f0", view: "physical-time-gamm", context,
        conditions: physicalGamm.model.conditions };
      $("results").hidden = false;
      renderOtherCards(sharedFilters, controls);
      setStatus(`Physical-time GAMM predictions shown for ${context}.`, "success");
      return;
    }
    if (state.detailActive && isF0 && gamm.model && $("contour-view").value === "gamm") {
      $("chart").hidden = true;
      $("gamm-chart").hidden = false;
      $("kpis").hidden = true;
      $("summary-table").hidden = true;
      const anyF0 = visibleLocalityEntries().some(entry => entry.loaded?.kind === "f0");
      $("time-axis-wrap").hidden = !anyF0;
      $("display-controls").hidden = !anyF0;
      $("time-axis-note").textContent = "The GAMM card always uses 0–100% time. This setting applies to other measured F0 cards in the workspace.";
      $("display-note").textContent = "These display settings apply to measured F0 cards; the original GAMM keeps its own semitone scale and model intervals.";
      $("result-title").textContent = `${gamm.model.conditions.join(" vs ")} · original GAMM`;
      $("result-profile").textContent = `Normalized 0–100% · ${gamm.model.scale_label}`;
      renderGammView({ container: $("gamm-chart"), model: gamm.model, context,
        measuredDurationGroups: gamm.model.conditions.map(modelCondition => ({ condition: modelCondition,
          rows: state.loaded.rows.filter(row => row.condition === modelCondition) })) });
      renderGammMeasuredReference(groups, mode, datasetPaired, "original GAMM", context);
      $("result-note").textContent = `The original GAMM predicts F0 on normalized time and a semitone scale across its model-source speakers and word pairs. It ignores the current speaker and pair choices; only context selects model panels. The accompanying duration summary is descriptive physical-time site data in milliseconds, not a model prediction.${gammSetKeys[state.loadedSet?.set.id] === "leer" ? " Leer model input has 480 contours; the physical-time site table has 479 with verified boundaries." : ""}`;
      state.lastResult = { kind: "f0", view: "original-gamm", context, conditions: gamm.model.conditions };
      $("results").hidden = false;
      renderOtherCards(sharedFilters, controls);
      setStatus(`Original GAMM predictions shown for ${context}. Select Measured comparison to return to Hz.`, "success");
      return;
    }
    $("chart").hidden = false;
    $("gamm-chart").hidden = true;
    $("gamm-chart").replaceChildren();
    $("kpis").hidden = false;
    $("summary-table").hidden = false;
    const anyF0 = visibleLocalityEntries().some(entry => entry.loaded?.kind === "f0");
    $("time-axis-wrap").hidden = !anyF0;
    $("display-controls").hidden = !anyF0;
    updateTimeAxisControls();
    $("display-note").textContent = "Sparse-bin cutoff and chart ranges change the measured view; source measurements are unchanged. Set the minimum to 1 to show every observed mean point.";
    const kindLabel = state.loaded.kind === "f0" ? "F0 (Hz)" : "duration (ms)";
    const title = datasetPaired
      ? `${primaryLabel}: ${valueA} (${context}) vs ${secondaryLabel}: ${valueB} (${secondContext}) · ${kindLabel}`
      : mode === "dataset" ? `${primaryLabel} (${context}) vs ${secondaryLabel} (${secondContext}) · ${kindLabel}`
      : paired && mode === "speaker" ? `${valueA} vs ${valueB} · ${pair} · ${context} · ${kindLabel}`
        : paired && mode === "condition" ? `${speaker || "All speakers"} · ${pair} · ${context} · ${valueA} vs ${valueB} · ${kindLabel}`
        : `${valueA} vs ${valueB} · ${kindLabel}`;
    const notes = [state.loadedSet?.set.timeBasis, mode === "dataset" ? state.comparisonSet?.set.timeBasis : null,
      datasetPaired
        ? `Each source contributes both recorded conditions from one complete pair or word; incomplete speaker/context cells are excluded. First source: ${valueA}, ${context}. Second source: ${valueB}, ${secondContext}. These are independent designs with source-specific condition labels${[state.loadedSet?.set.id, state.comparisonSet?.set.id].includes("leer-f0") && [state.loadedSet?.set.id, state.comparisonSet?.set.id].includes("aachen-f0") ? " (Leer vowel length and Aachen historical accent classes)" : ""}; the four groups are a descriptive comparison, not a pooled effect or significance test.`
        : null,
      paired && mode === "speaker" ? `Each speaker has both ${conditions.join(" and ")} in the same recorded pair and context. The two speaker groups use the same chart scales.` : null]
      .filter(Boolean).join(" ");
    const result = renderPhysicalComparison({ kind: state.loaded.kind, groups, controls, title, note: notes,
      speakerFacets: paired && mode === "speaker",
      elements: { titleNode: $("result-title"), profileNode: $("result-profile"), kpis: $("kpis"),
        chart: $("chart"), summary: $("summary-table"), noteNode: $("result-note") } });
    renderCurrentEvidence(groups, mode, datasetPaired);
    state.lastResult = result;
    $("results").hidden = !state.detailActive;
    renderOtherCards(sharedFilters, controls);
    setStatus(`Comparison ready: ${groups.map(group => `${group.label}: ${format(group.rows.length)} records`).join("; ")}${state.loaded.kind === "f0" ? " (including any marked missing F0 points)" : ""}.`, "success");
  } catch (error) {
    $("results").hidden = true;
    $("comparison-evidence").hidden = true;
    state.lastResult = null;
    const focusedCard = $("results").closest(".overview-card");
    if (focusedCard) focusedCard.append(element("p", "overview-unavailable focused-error", error.message || "Comparison unavailable."));
    try {
      const mode = $("compare-mode").value;
      renderOtherCards({ mode, valueA: $("condition-a").value, valueB: $("condition-b").value,
        pair: mode === "pair" || mode === "dataset" ? "" : $("pair-filter").value,
        context: mode === "context" ? "" : $("context-filter").value,
        condition: $("condition-filter").value,
        speaker: boundPairComparison() && mode === "condition" ? $("speaker-filter").value : "",
        paired: boundPairComparison() && ["condition", "speaker"].includes(mode),
        conditions: boundPairComparison() ? comparisonConditions(state.loaded.rows) : [] }, readDisplayControls());
    } catch {
      document.querySelectorAll(".overview-result").forEach(result => {
        if (!result.hidden) result.replaceChildren(element("p", "overview-unavailable", "Fix the display controls to redraw this measurement."));
      });
    }
    setStatus(error.message || "Comparison unavailable.", "error");
  }
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
  const tools = [
    {
      name: "filter_dialect_atlas",
      title: "Filter dialect atlas",
      description: "Search the visible dialect atlas by text, language group, contrast profile, and place. Place choices depend on the language group and contrast.",
      inputSchema: { type: "object", properties: {
        query: { type: "string" },
        family: { type: "string" },
        contrast: { type: "string", enum: ["", "accent", "quantity"] },
        place: { type: "string" }
      }, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected filter object.");
        if (input.query !== undefined && typeof input.query !== "string") throw new Error("query must be text.");
        if (input.family !== undefined && input.family !== "" && !state.catalog.some(dialect => dialect.family === input.family)) throw new Error("Invalid language group.");
        const family = input.family ?? $("family-filter").value;
        const contrast = input.contrast ?? $("contrast-filter").value;
        if (!["", "accent", "quantity"].includes(contrast)) throw new Error("Invalid contrast profile.");
        if (input.place !== undefined && input.place !== "" && !placesForFamily(family, contrast).includes(input.place))
          throw new Error("Invalid place for the selected language group and contrast.");
        if (input.query !== undefined) $("search").value = input.query;
        if (input.family !== undefined) $("family-filter").value = input.family;
        if (input.contrast !== undefined) $("contrast-filter").value = input.contrast;
        updatePlaceOptions();
        if (input.place !== undefined) $("place-filter").value = input.place;
        renderCatalog();
        return { count: filteredCatalog().length, dialectIds: filteredCatalog().map(dialect => dialect.id) };
      }
    },
    {
      name: "summarize_loaded_measurements",
      title: "Summarize loaded measurements",
      description: "Run a visible physical-unit comparison of two conditions in the loaded dataset.",
      inputSchema: { type: "object", properties: {
        conditionA: { type: "string" }, conditionB: { type: "string" }, pair: { type: "string" }, context: { type: "string" }
      }, required: ["conditionA", "conditionB"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input) {
        if (!state.loaded) throw new Error("Open a compatible local CSV first.");
        if (!input || typeof input.conditionA !== "string" || typeof input.conditionB !== "string") throw new Error("Two condition names are required.");
        $("compare-mode").value = "condition";
        refreshGroupControls(false);
        const context = input.context ?? $("context-filter").value;
        if (!context) throw new Error("Choose one context for this comparison.");
        const pair = input.pair ?? $("pair-filter").value;
        for (const [id, value] of [["condition-a", input.conditionA], ["condition-b", input.conditionB], ["pair-filter", pair], ["context-filter", context]]) {
          if (![...$(id).options].some(option => option.value === value)) throw new Error(`Invalid ${id} choice.`);
        }
        $("condition-a").value = input.conditionA;
        $("condition-b").value = input.conditionB;
        $("pair-filter").value = pair;
        $("context-filter").value = context;
        $("contour-view").value = "measured";
        state.detailActive = true;
        placeFocusedResult(state.loadedSet);
        runAnalysis();
        if ($("results").hidden) throw new Error($("analysis-status").textContent);
        return state.lastResult;
      }
    }
  ];
  tools.forEach(tool => {
    try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); }
    catch { /* Browsers without full WebMCP support keep the visible interface. */ }
  });
}

async function init() {
  try {
    const [response, basemapResponse, gammResponse, physicalGammResponse, boundaryResponse] = await Promise.all([
      fetch("./catalog.json", { cache: "no-store" }),
      fetch("./atlas-basemap.geojson", { cache: "no-store" }).catch(() => null),
      fetch("./data/gamm-population.json", { cache: "no-store" }).catch(() => null),
      fetch("./data/gamm-physical-time.json", { cache: "no-store" }).catch(() => null),
      fetch("./tonal-isogloss.geojson", { cache: "no-store" }).catch(() => null)
    ]);
    if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
    state.catalog = await response.json();
    if (basemapResponse?.ok) state.basemap = await basemapResponse.json();
    if (boundaryResponse?.ok) {
      try { state.boundaries = await boundaryResponse.json(); } catch { state.boundaries = null; }
    }
    $("boundary-layer-wrap").hidden = !state.boundaries?.features?.length;
    if (gammResponse?.ok) {
      try { state.gammModels = (await gammResponse.json()).models; }
      catch { state.gammModels = null; }
    }
    if (physicalGammResponse?.ok) {
      try { state.physicalGammModels = (await physicalGammResponse.json()).models; }
      catch { state.physicalGammModels = null; }
    }
    const familyFilter = $("family-filter");
    const linkedSelect = $("linked-set");
    linkedWordSets.forEach(item => {
      const option = element("option", "", item.title);
      option.value = item.id;
      linkedSelect.append(option);
    });
    const families = [...new Set(state.catalog.map(dialect => dialect.family).filter(Boolean))].sort();
    const legend = $("map-language-legend");
    legend.replaceChildren();
    families.forEach(family => {
      const option = element("option", "", family);
      option.value = family;
      familyFilter.append(option);
      const item = element("span", "map-legend-item");
      const dot = element("span", "map-legend-dot");
      dot.setAttribute("aria-hidden", "true");
      dot.style.backgroundColor = languageColor(family);
      item.append(dot, document.createTextNode(family));
      legend.append(item);
    });
    updatePlaceOptions();
    renderCatalog();
    const included = state.catalog.find(dialect => dialect.measurementSets.some(set => set.kind === "f0" && set.dataFile))
      || state.catalog.find(dialect => dialect.measurementSets.some(set => set.dataFile));
    if (included) state.activeDialectId = included.id;
    $("locality-metadata-button").addEventListener("click", () => {
      const dialect = activeDialect();
      if (dialect) showDialect(dialect);
    });
    await onSourceChange();
  } catch (error) {
    $("catalog-empty").hidden = false;
    $("catalog-empty").textContent = "The catalog could not load. Reload this page from a local web server.";
  }
  $("search").addEventListener("input", renderCatalog);
  $("family-filter").addEventListener("change", () => { updatePlaceOptions(); renderCatalog(); });
  $("contrast-filter").addEventListener("change", () => { updatePlaceOptions(); renderCatalog(); });
  $("literature-layer").addEventListener("change", () => { updatePlaceOptions(); renderCatalog(); });
  $("boundary-layer").addEventListener("change", renderCatalog);
  $("place-filter").addEventListener("change", renderCatalog);
  $("analysis-mode").addEventListener("change", () => { $("file-input").value = ""; updateMode(); });
  $("file-input").addEventListener("change", onFileChange);
  $("analysis-form").addEventListener("submit", event => { event.preventDefault(); runAnalysis(); });
  $("compare-mode").addEventListener("change", onCompareModeChange);
  $("linked-set").addEventListener("change", onLinkedSetChange);
  $("linked-context").addEventListener("change", () => {
    updateLinkedSpeaker(0);
    updateLinkedSpeaker(1);
    runLinkedAnalysis();
  });
  for (const id of ["linked-speaker-a", "linked-speaker-b"]) $(id).addEventListener("change", runLinkedAnalysis);
  $("contour-view").addEventListener("change", runAnalysis);
  $("time-axis").addEventListener("change", () => { updateTimeAxisControls(); runAnalysis(); });
  $("source-b").addEventListener("change", onSecondarySourceChange);
  $("condition-a").addEventListener("change", () => {
    if (boundPairComparison() && $("compare-mode").value === "speaker") refreshGroupControls();
    runAnalysis();
  });
  $("condition-b").addEventListener("change", runAnalysis);
  ["condition-filter", "speaker-filter", "pair-filter", "context-filter", "context-b"].forEach(id => $(id).addEventListener("change", () => {
    refreshGroupControls();
    runAnalysis();
  }));
  ["f0-min", "f0-max", "time-max", "minimum-tokens"].forEach(id => $(id).addEventListener("change", runAnalysis));
  $("show-traces").addEventListener("change", runAnalysis);
  $("reset-display").addEventListener("click", () => {
    ["f0-min", "f0-max", "time-max"].forEach(id => { $(id).value = ""; });
    $("minimum-tokens").value = "5";
    runAnalysis();
  });
  $("dialog-close").addEventListener("click", () => $("dataset-dialog").close());
  $("dialog-done").addEventListener("click", () => $("dataset-dialog").close());
  updateMode();
  registerWebMcp();
}
init();
