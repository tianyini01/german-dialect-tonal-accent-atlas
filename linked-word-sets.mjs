// Curated navigation candidates, not claims of established cognacy.
// Source condition labels remain local to each measurement set.
export const linkedWordSets = [
  {
    id: "rice-giant",
    title: "Ries / Riez ↔ Reis / Riese",
    shortTitle: "Rice / giant word forms",
    status: "Riez / Riese is a likely cognate link. Leer Ries means ‘rice’; Aachen reis has no source gloss here, and German Reis can also mean ‘twig’. Its alignment remains a candidate.",
    alignments: [
      { gloss: "rice (Leer gloss)", forms: ["Ries", "Reis"] },
      { gloss: "giant (Leer gloss)", forms: ["Riez", "Riese"] }
    ],
    // These match sentence type and position, but Aachen does not record focus.
    contexts: [
      { id: "declarative-nonfinal", label: "Declarative non-final", recorded: ["Declarative non-final focus", "Declarative Non-final"] },
      { id: "declarative-final", label: "Declarative final", recorded: ["Declarative final focus", "Declarative Final"] },
      { id: "interrogative-nonfinal", label: "Interrogative non-final", recorded: ["Interrogative non-final focus", "Interrogative Non-final"] },
      { id: "interrogative-final", label: "Interrogative final", recorded: ["Interrogative final focus", "Interrogative Final"] }
    ],
    contextNote: "Sentence type and final/non-final position can be matched approximately. Leer records focus; the Aachen labels do not establish an equivalent focus condition.",
    members: [
      { setId: "leer-f0", pair: "Ries vs. Riez", lexicalNote: "Ries ‘rice’ ↔ Reis; Riez ‘giant’ ↔ Riese (candidate forms)." },
      { setId: "aachen-f0", pair: "Riese vs. Reis", lexicalNote: "Reis ↔ Ries; Riese ↔ Riez (candidate forms)." }
    ]
  },
  {
    id: "side-silk",
    title: "Siet / Sied ↔ Seite / Seide",
    shortTitle: "Side / silk word forms",
    status: "Leer glosses support the side / silk links; Baden workbook glosses were not recorded. These are likely lexical alignments, not matched prosodic experiments.",
    alignments: [
      { gloss: "side (Leer gloss)", forms: ["Siet", "Seite"] },
      { gloss: "silk (Leer gloss)", forms: ["Sied", "Seide"] }
    ],
    // Baden has only one workbook context. Its relationship to any Leer
    // prosodic context is unverified, so the selector filters Leer only.
    contextSelection: "first-source-only",
    contextNote: "Baden has one workbook context without a verified sentence type, position, or focus match to Leer. Its S1–S6 codes are workbook series, not verified independent speakers.",
    members: [
      { setId: "leer-duration", pair: "Siet vs. Sied", lexicalNote: "Siet ‘side’ ↔ Seite; Sied ‘silk’ ↔ Seide (candidate forms)." },
      { setId: "baden-seide-seite-duration", pair: "Seide / Seite", lexicalNote: "Seite ↔ Siet; Seide ↔ Sied (candidate forms)." }
    ]
  }
];

// Align only the display order. The recorded condition, word, and measurements
// stay with their original group; row 1/color 1 is alignment 1 in both panels.
export function orderLinkedGroups(spec, memberIndex, groups) {
  const key = word => String(word ?? "").trim().toLocaleLowerCase();
  if (groups.length !== 2 || spec.alignments?.length !== 2) {
    throw new Error("This etymology comparison needs two recorded words in each dialect.");
  }
  const expected = spec.alignments.map(alignment => key(alignment.forms?.[memberIndex]));
  if (expected.some(word => !word) || new Set(expected).size !== expected.length) {
    throw new Error("The etymology word alignment is missing or ambiguous.");
  }
  const observed = groups.map(group => [...new Set((group.rows || []).map(row => key(row.word)))]);
  if (observed.some(words => words.length !== 1 || !words[0])) {
    throw new Error("A recorded condition contains missing or mixed word labels; its alignment cannot be shown.");
  }
  return expected.map(word => {
    const matches = groups.filter((_, index) => observed[index][0] === word);
    if (matches.length !== 1) throw new Error(`Expected word ${word} is missing or duplicated in this etymology comparison.`);
    return matches[0];
  });
}
