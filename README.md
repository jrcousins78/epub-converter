# EPUB Converter

Turn a week's class readings into **one EPUB** for your Kobo or Boox. Drop in text PDFs, scanned PDFs, phone photos of book pages, or Word files. You get a single book with a table of contents entry for each reading and the original page numbers for citing.

**Live site:** https://jrcousins78.github.io/epub-converter/ (after the one-time setup below)

Everything runs in your browser. Your readings are never uploaded anywhere.

## What it does

- **Any mix of files.** Text PDFs are read directly. Scanned PDFs and photos go through text recognition (OCR). Word files keep their headings, italics and footnotes.
- **Photos.** iPhone HEIC files are converted, the phone's rotation is applied, and photos of a two-page spread are split into two pages. Photos you add together become one reading.
- **Clean-up for bad scans.** Uneven lighting is flattened before OCR. Running headers and footers are removed, words hyphenated across lines are rejoined, and two-column pages are read in the right order.
- **Page numbers for citing.** Small `[p. 47]` markers come from the printed page numbers. If none are found, you can set "first page is p. 112" in Review.
- **Footnotes** are collected into a Notes section at the end of each reading, with links both ways. Kobo shows them as pop-ups.
- **Figures** (charts, maps, photos) are kept as images, with captions when one is found.
- **Weekly bundle.** There's no limit on the number of readings. Give each one a course and the contents are grouped by course, then reading, then section.
- **Optional review.** View each scanned page next to its recognised text and fix typos, mark headings, or remove junk. Pages the OCR wasn't sure about are flagged. Rotate and re-run OCR if a photo was sideways.
- **Autosave.** Work in progress is kept in your browser, so closing the tab doesn't lose it.
- **Kobo option.** Settings can output a `.kepub.epub` for faster page turns. Kobo's own documentation says sideloaded KEPUBs may disable bookmarks and notes, so try one first. Leave it off for Boox.

## Using it

1. Open the site and give the book a title, e.g. *SOC 101 – Week 5*.
2. Drop in all the readings. They are processed one after another. Text PDFs take seconds; scans take about 1–3 seconds per page.
3. Optional: rename readings, set a course, drag to reorder, or open **Review** on anything flagged.
4. Click **Build EPUB**.
5. Copy the file to your e-reader:
   - **Kobo:** connect by USB and copy it into the main folder, or use Kobo's Dropbox or Google Drive integration.
   - **Boox:** use the BooxDrop app (it gives you an address to open in your computer's browser) or Send2Boox.

### Tips for better results from photos

- Take photos flat-on, in good light, with the whole page in frame.
- If your readings aren't in English, choose the language in Settings before adding them.

## One-time setup to publish the site

The repo must be **public** to use GitHub Pages on a free account.

1. Merge this branch into `main`.
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The *Deploy to GitHub Pages* workflow runs on every push to `main`. The site appears at `https://<your-user>.github.io/epub-converter/`.

## Limits

- **Time:** OCR takes about 1–3 seconds per scanned page on a laptop. 25 readings of 20 scanned pages is roughly 10–25 minutes. Text PDFs and Word files are near-instant. Phones work, but slowly.
- **Size:** there is no built-in cap. Kobo recommends EPUBs under 1 GB. A text-only 500-page bundle is about 1–5 MB; figures add roughly 100–300 KB each.
- **Not included:** equation recognition and table reconstruction from scans (these are kept as images), handwriting, layouts that reproduce the PDF page exactly, Kindle formats, and DRM-protected files.
- **Never commit real readings to this repo.** It is public. The test files are generated from public-domain text (J. S. Mill, *On Liberty*, 1859).

## Development

```bash
npm install
npm run dev            # local dev server
npm test               # unit tests (structure rebuilding, EPUB writer)
npm run check          # type checks
npm run test:e2e       # browser test: converts real PDFs, scans, photos and Word files
node scripts/epubcheck.mjs file.epub   # validate with W3C EPUBCheck (needs Java)
```

How it's built: Vite + Svelte 5 + TypeScript. [PDF.js](https://github.com/mozilla/pdf.js) reads PDFs, [Tesseract.js](https://github.com/naptha/tesseract.js) does OCR (served from this site, so it works offline), [mammoth.js](https://github.com/mwilliamson/mammoth.js) reads Word files, and [heic2any](https://github.com/alexcorvi/heic2any) converts iPhone photos. The EPUB writer is custom: EPUB 3 with an NCX fallback, `mimetype` stored first and uncompressed, and XHTML files split at about 250 KB for fast page turns. CI validates generated books with [EPUBCheck](https://github.com/w3c/epubcheck).

| Folder | What's there |
|---|---|
| `src/lib/ingest/` | Reading PDFs, photos and Word files |
| `src/lib/ocr/` | Image clean-up, OCR worker pool, figure detection |
| `src/lib/structure/` | Rebuilding paragraphs, headings, footnotes and page numbers |
| `src/lib/epub/` | The EPUB writer (ZIP, package, navigation, cover, KEPUB) |
| `src/components/` | The interface |

## Sources

- GitHub Pages is static-only and free for public repos: [GitHub Docs – Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [GitHub Community #167372](https://github.com/orgs/community/discussions/167372)
- Kobo file-size guidance, NCX handling, footnote pop-ups and KEPUB caveats: [kobolabs/epub-spec](https://github.com/kobolabs/epub-spec); KEPUB benefits: [kepubify](https://github.com/geek1011/kepubify)
- EPUB container rules (`mimetype` first, uncompressed): [IDPF EPUB OCF 3.0.1](https://idpf.org/epub/301/spec/epub-ocf.html), [MobileRead Wiki](https://wiki.mobileread.com/wiki/EPub)
- Browser storage quotas: [web.dev – Storage for the web](https://web.dev/articles/storage-for-the-web)
- Moving files to devices: [Kobo Help](https://help.kobo.com/hc/en-us/articles/360024775093-Add-non-protected-PDF-and-ePub-files-to-your-Kobo-eReader-using-your-computer), [BOOX file transfer guide](https://onyxboox.medium.com/the-complete-guide-of-transferring-files-to-boox-eb01f099f65e)
