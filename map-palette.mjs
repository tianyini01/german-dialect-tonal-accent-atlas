const LANGUAGE_COLORS = Object.freeze({
  "Low German": "#0c7080",
  Franconian: "#b7772a"
});

export function languageColor(family) {
  return LANGUAGE_COLORS[family] || "#697883";
}
