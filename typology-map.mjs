export function contrastSymbol(entry) {
  switch (entry?.typology?.profile) {
    case "quantity": return "Q";
    case "accent": return "A";
    default: return "?";
  }
}

export function contrastBasisClass(entry) {
  if (entry?.typology?.profile === "unresolved") return "unclassified";
  return entry?.typology?.classificationSource === "literature" ? "literature-only" : "";
}
