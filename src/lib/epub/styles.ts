// E-ink friendly styling. Kept deliberately light so the reader's own font,
// size and margin settings still work on Kobo and Boox.
export const STYLESHEET = `@charset "utf-8";
body { margin: 0 2%; line-height: 1.45; }
p { margin: 0; text-indent: 1.2em; }
header + p, h1 + p, h2 + p, h3 + p, h4 + p, figure + p, ul + p, ol + p, table + p,
p.pgline + p, blockquote + p, p.quote + p { text-indent: 0; }
p.quote { margin: 0.6em 1.5em; text-indent: 0; font-size: 0.95em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.2; text-indent: 0; page-break-after: avoid; break-after: avoid; }
h2 { font-size: 1.3em; margin: 1.4em 0 0.6em; }
h3 { font-size: 1.15em; margin: 1.2em 0 0.5em; }
h4, h5, h6 { font-size: 1em; margin: 1em 0 0.4em; }
header.reading-head { margin: 2em 0 1.5em; text-align: left; }
header.reading-head h1 { font-size: 1.6em; margin: 0.2em 0 0.3em; }
header.reading-head .course, header.reading-head .source { font-size: 0.8em; text-indent: 0; color: #555; font-family: sans-serif; }
header.reading-head .byline { font-style: italic; text-indent: 0; margin-bottom: 0.4em; }
.pg { font-size: 0.65em; color: #666; font-family: sans-serif; font-style: normal; font-weight: normal; text-indent: 0; white-space: nowrap; }
p.pgline { text-indent: 0; text-align: right; margin: 0.3em 0; }
figure { margin: 1em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
figure img { max-width: 100%; height: auto; }
figcaption { font-size: 0.85em; text-indent: 0; margin-top: 0.3em; }
ul, ol { margin: 0.5em 0 0.5em 1.5em; padding: 0; }
table { border-collapse: collapse; margin: 0.8em 0; font-size: 0.9em; }
td { border: 1px solid #999; padding: 0.2em 0.4em; vertical-align: top; }
sup { font-size: 0.7em; line-height: 0; }
a.nref { text-decoration: none; }
ul.notes { list-style: none; margin: 0; padding: 0; }
ul.notes li { margin: 0 0 0.6em; }
ul.notes p { text-indent: 0; font-size: 0.9em; }
.notes-for { text-indent: 0; font-style: italic; margin-bottom: 1em; }
.where { color: #666; font-size: 0.85em; }
.title-page { margin-top: 3em; }
.title-page h1 { font-size: 1.8em; margin-bottom: 0.2em; }
.title-page .subtitle { text-indent: 0; color: #555; margin-bottom: 2em; }
.title-page ol { list-style: none; margin: 0; padding: 0; }
.title-page li { margin: 0 0 0.5em; }
.title-page li.course { margin-top: 1em; font-weight: bold; font-family: sans-serif; font-size: 0.9em; }
.title-page .who { color: #555; font-size: 0.85em; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100%; }
`;
