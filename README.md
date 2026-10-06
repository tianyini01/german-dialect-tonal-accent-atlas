# Germanic Dialect Tonal Accent Atlas

An interactive atlas of approved derived measurements from Germanic dialect studies. Browse localities, compare recorded F0 contours and vowel duration, inspect the original and exploratory GAMM views, and compare candidate etymological word pairs across dialects.

**Website:** https://tianyini01.github.io/german-dialect-tonal-accent-atlas/

## Edit and publish

This repository is the complete static website. Edit `index.html`, `styles.css`, the JavaScript modules, `catalog.json`, or files in `data/` directly on a clone of this repository. Commit and push to `main`; GitHub Pages publishes from the repository root. No build step is required.

To preview locally from this directory, run `python3 -m http.server 8000` and open `http://localhost:8000/`.

## Research data

`data/` contains the approved derived CSV measurements and model summaries used by the site. These files are public in this repository and accessible to browsers. Original recordings, TextGrid annotations, fieldwork workbooks, photographs, and exact speaker coordinates are not included. The atlas describes candidate lexical alignments and keeps each dataset's recorded conditions and contexts separate.

The existing ChatGPT Site is a separate deployment. Changes pushed here update the GitHub Pages site only.
