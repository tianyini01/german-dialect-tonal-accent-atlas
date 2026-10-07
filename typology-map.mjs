export function contrastSymbol(entry) {
  switch (entry?.typology?.kind) {
    case "length": return "L";
    case "accent": return "A";
    default: return "?";
  }
}

export function contrastBasisClass(entry) {
  if (entry?.typology?.kind === "unclassified") return "unclassified";
  return entry?.typology?.classificationSource === "literature" ? "literature-only" : "";
}
