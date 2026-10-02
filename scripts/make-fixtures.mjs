// Generates the test fixtures in tests/fixtures from public-domain text
// (J. S. Mill, "On Liberty", 1859). Needs pdftoppm (poppler) and ImageMagick.
// The outputs are committed, so CI does not need to run this.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'tests/fixtures';
const TMP = join(OUT, '.tmp');
mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const P1 =
  'The time, it is to be hoped, is gone by, when any defence would be necessary of the liberty of the press as one of the securities against corrupt or tyrannical government.^1 No argument, we may suppose, can now be needed, against permitting a legislature or an executive, not identified in interest with the people, to prescribe opinions to them, and determine what doctrines or what arguments they shall be allowed to hear.';
const P2 =
  'Let us suppose, therefore, that the government is entirely at one with the people, and never thinks of exerting any power of coercion unless in agreement with what it conceives to be their voice. But I deny the right of the people to exercise such coercion, either by themselves or by their government. The power itself is illegitimate. The best government has no more title to it than the worst. It is as noxious, or more noxious, when exerted in accordance with public opinion, than when in opposition to it.';
const P3 =
  'If all mankind minus one, were of one opinion, and only one person were of the contrary opinion, mankind would be no more justified in silencing that one person, than he, if he had the power, would be justified in silencing mankind. Were an opinion a personal possession of no value except to the owner; if to be obstructed in the enjoyment of it were simply a private injury, it would make some difference whether the injury was inflicted only on a few persons or on many.';
const P4 =
  'But the peculiar evil of silencing the expression of an opinion is, that it is robbing the human race; posterity as well as the existing generation; those who dissent from the opinion, still more than those who hold it. If the opinion is right, they are deprived of the opportunity of exchanging error for truth: if wrong, they lose, what is almost as great a benefit, the clearer perception and livelier impression of truth, produced by its collision with error.';
const P5 =
  'It is necessary to consider separately these two hypotheses, each of which has a distinct branch of the argument corresponding to it. We can never be sure that the opinion we are endeavouring to stifle is a false opinion; and if we were sure, stifling it would be an evil still.';
const P6 =
  'First: the opinion which it is attempted to suppress by authority may possibly be true. Those who desire to suppress it, of course deny its truth; but they are not infallible. They have no authority to decide the question for all mankind, and exclude every other person from the means of judging. To refuse a hearing to an opinion, because they are sure that it is false, is to assume that their certainty is the same thing as absolute certainty.';
const P7 =
  'Unfortunately for the good sense of mankind, the fact of their fallibility is far from carrying the weight in their practical judgment, which is always allowed to it in theory; for while every one well knows himself to be fallible, few think it necessary to take any precautions against their own fallibility, or admit the supposition that any opinion of which they feel very certain, may be one of the examples of the error to which they acknowledge themselves to be liable.';
const NOTE = 'These words were written in 1858, when prosecutions of the press were still a recent memory.';

// ---------------------------------------------------------------------------
// 1) Text PDF laid out like a book page (6 x 9 in), with running heads,
//    page numbers, a footnote and hyphenated line ends.

const W = 432;
const H = 648;
const M = 54;
const SIZE = 11;
const LEAD = 14.5;

const pdf = await PDFDocument.create();
pdf.setTitle('On Liberty – Chapter II');
pdf.setAuthor('John Stuart Mill');
const roman = await pdf.embedFont(StandardFonts.TimesRoman);
const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

function wrap(text, width, indent) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  let avail = width - indent;
  const fits = (t) => roman.widthOfTextAtSize(t.replace('^1', ''), SIZE) <= avail;
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const t = line ? `${line} ${w}` : w;
    if (fits(t)) {
      line = t;
      i++;
      continue;
    }
    if (!line) {
      lines.push(w);
      i++;
      continue;
    }
    // Hyphenate a long word to fill the line, like a typeset book.
    let split = false;
    if (/^[a-z]{9,}[,;.]?$/.test(w)) {
      for (let k = w.length - 4; k >= 4; k--) {
        const head = `${line} ${w.slice(0, k)}-`;
        if (fits(head)) {
          lines.push(head);
          words[i] = w.slice(k);
          split = true;
          break;
        }
      }
    }
    if (!split) lines.push(line);
    line = '';
    avail = width;
  }
  if (line) lines.push(line);
  return lines;
}

const pages = [];
let page;
let y;
let pageNo = 20;
function newPage() {
  page = pdf.addPage([W, H]);
  pageNo++;
  pages.push(page);
  const head = pageNo % 2 ? 'OF THOUGHT AND DISCUSSION' : 'ON LIBERTY';
  page.drawText(head, { x: (W - roman.widthOfTextAtSize(head, 8)) / 2, y: H - 36, size: 8, font: roman });
  const num = String(pageNo);
  page.drawText(num, { x: (W - roman.widthOfTextAtSize(num, 9)) / 2, y: 30, size: 9, font: roman });
  y = H - 72;
}

function drawLine(text, x, isLastOfPara) {
  // Superscript note marker.
  const parts = text.split('^1');
  let cx = x;
  parts.forEach((p, i) => {
    page.drawText(p, { x: cx, y, size: SIZE, font: roman });
    cx += roman.widthOfTextAtSize(p, SIZE);
    if (i < parts.length - 1) {
      page.drawText('1', { x: cx + 0.5, y: y + 4, size: 7, font: roman });
      cx += roman.widthOfTextAtSize('1', 7) + 1;
    }
  });
  return isLastOfPara;
}

newPage();
page.drawText('CHAPTER II', { x: (W - bold.widthOfTextAtSize('CHAPTER II', 15)) / 2, y: y - 10, size: 15, font: bold });
y -= 40;
const sub = 'Of the Liberty of Thought and Discussion';
page.drawText(sub, { x: (W - bold.widthOfTextAtSize(sub, 12.5)) / 2, y, size: 12.5, font: bold });
y -= 32;

const footnoteTop = 90; // keep space for the footnote on the first page
let first = true;
for (const para of [P1, P2, P3, P4, P5, P6, P7]) {
  const lines = wrap(para, W - 2 * M, 18);
  lines.forEach((l, i) => {
    const floor = first ? footnoteTop : 60;
    if (y < floor) {
      if (first) {
        // Footnote at the bottom of page 1.
        page.drawLine({ start: { x: M, y: 80 }, end: { x: M + 80, y: 80 }, thickness: 0.5, color: rgb(0, 0, 0) });
        const nl = wrap(`1 ${NOTE}`, (W - 2 * M) * 1.25, 0);
        let fy = 68;
        for (const t of nl) {
          page.drawText(t, { x: M, y: fy, size: 8.5, font: roman });
          fy -= 10.5;
        }
        first = false;
      }
      newPage();
    }
    drawLine(l, M + (i === 0 ? 18 : 0), i === lines.length - 1);
    y -= LEAD;
  });
}
writeFileSync(join(OUT, 'mill-text.pdf'), await pdf.save());
console.log('mill-text.pdf:', pages.length, 'pages');

// ---------------------------------------------------------------------------
// 2) "Scanned" PDF: render pages to images, degrade them, wrap as image-only PDF.

execFileSync('pdftoppm', ['-r', '200', '-png', join(OUT, 'mill-text.pdf'), join(TMP, 'pg')]);
const pngs = readdirSync(TMP).filter((f) => f.startsWith('pg') && f.endsWith('.png')).sort();
const scan = await PDFDocument.create();
for (const [i, f] of pngs.entries()) {
  const src = join(TMP, f);
  const out = join(TMP, `scan-${i}.jpg`);
  // Slight rotation, blur, noise, grey paper and a darker binding edge.
  execFileSync('convert', [
    src,
    '-background', 'white', '-rotate', i % 2 ? '-1.2' : '0.9',
    '-colorspace', 'Gray',
    '(', '+clone', '-sparse-color', 'Barycentric', `0,0 gray(80%) %w,0 gray(97%)`, ')',
    '-compose', 'Multiply', '-composite',
    '-blur', '0x0.6',
    '+noise', 'Gaussian', '-attenuate', '0.35',
    '-quality', '70',
    out,
  ]);
  const jpg = await scan.embedJpg(readFileSync(out));
  const p = scan.addPage([W, H]);
  p.drawImage(jpg, { x: 0, y: 0, width: W, height: H });
}
writeFileSync(join(OUT, 'mill-scan.pdf'), await scan.save());
console.log('mill-scan.pdf:', pngs.length, 'pages');

// ---------------------------------------------------------------------------
// 3) Phone photo of an open book: two pages side by side, binding shadow,
//    uneven light, small tilt.

execFileSync('convert', [
  join(TMP, pngs[0]), join(TMP, pngs[1]), '+append',
  '-colorspace', 'Gray',
  '(', '+clone', '-sparse-color', 'Barycentric', '0,0 gray(70%) %w,%h gray(100%)', ')',
  '-compose', 'Multiply', '-composite',
  '(', '+clone', '-fill', 'white', '-colorize', '100', '-fill', 'gray(55%)', '-draw', 'rectangle 1186,0 1214,1800', '-blur', '0x14', ')',
  '-compose', 'Multiply', '-composite',
  '-background', 'gray(40%)', '-rotate', '1.5',
  '-resize', '2400x',
  '+noise', 'Gaussian', '-attenuate', '0.25',
  '-quality', '78',
  join(OUT, 'mill-photo-spread.jpg'),
]);
console.log('mill-photo-spread.jpg');

// ---------------------------------------------------------------------------
// 4) Word document with a title, a heading, italics, a list and a footnote.

const docx = new JSZip();
docx.file(
  '[Content_Types].xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
</Types>`,
);
docx.file(
  '_rels/.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
);
docx.file(
  'word/_rels/document.xml.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
</Relationships>`,
);
docx.file(
  'word/styles.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>
</w:styles>`,
);
const run = (t, i = false) => `<w:r>${i ? '<w:rPr><w:i/></w:rPr>' : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
docx.file(
  'word/document.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run('Reading Guide: Mill on Free Expression')}</w:p>
<w:p>${run('Read chapter II of ')}${run('On Liberty', true)}${run(' before seminar.')}<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run('Questions to consider')}</w:p>
<w:p>${run('What are the two hypotheses Mill considers, and why does he treat them separately?')}</w:p>
<w:p>${run('Why is silencing an opinion a harm even when the opinion is false?')}</w:p>
</w:body>
</w:document>`,
);
docx.file(
  'word/footnotes.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
<w:footnote w:id="1"><w:p>${run('Any edition is fine; page numbers in class refer to the 1859 first edition.')}</w:p></w:footnote>
</w:footnotes>`,
);
writeFileSync(join(OUT, 'mill-guide.docx'), await docx.generateAsync({ type: 'uint8array' }));
console.log('mill-guide.docx');

rmSync(TMP, { recursive: true, force: true });
