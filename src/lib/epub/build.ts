// Assembles a whole weekly bundle into one EPUB 3 file.
import type { BundleSettings, Reading, StoredImage } from '../model';
import { esc, utf8 } from '../util/xml';
import { uid } from '../util/id';
import { ZipWriter, type ZipSink } from './zip';
import { pageRange, renderReading, xhtmlDocument, type ImageRef, type PageTarget, type RenderedReading, type TocNode } from './render';
import { STYLESHEET } from './styles';

export interface BuildInput {
  settings: BundleSettings;
  readings: Reading[];
  getImage: (id: string) => Promise<StoredImage | undefined>;
  cover?: StoredImage;
  now?: Date;
  identifier?: string;
}

export interface BuildResult {
  fileName: string;
  bytes: number;
  files: string[];
}

/** Puts readings of the same course next to each other, keeping the user's order otherwise. */
export function orderReadings(readings: Reading[]): { ordered: Reading[]; grouped: boolean } {
  const courses: string[] = [];
  for (const r of readings) {
    const c = r.course.trim();
    if (!courses.includes(c)) courses.push(c);
  }
  const grouped = courses.filter(Boolean).length > 1;
  if (!grouped) return { ordered: readings, grouped };
  const ordered = courses.flatMap((c) => readings.filter((r) => r.course.trim() === c));
  return { ordered, grouped };
}

export function epubFileName(settings: BundleSettings): string {
  const base =
    settings.title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'readings';
  return `${base}${settings.kepub ? '.kepub.epub' : '.epub'}`;
}

const ext = (mime: string) => (mime === 'image/png' ? 'png' : 'jpg');

export async function buildEpub(input: BuildInput, sink: ZipSink): Promise<BuildResult> {
  const { settings } = input;
  const now = input.now ?? new Date();
  const identifier = input.identifier ?? `urn:uuid:${uid()}`;
  const lang = settings.language || 'en';
  const { ordered, grouped } = orderReadings(input.readings.filter((r) => r.status === 'done'));

  // Pass 1: image metadata (the image bytes are fetched again when written).
  const imageRefs = new Map<string, ImageRef & { mime: string; manifestId: string }>();
  let imgN = 0;
  for (const r of ordered) {
    for (const b of r.blocks) {
      if (b.kind !== 'figure' || imageRefs.has(b.image)) continue;
      const img = await input.getImage(b.image);
      if (!img) continue;
      imgN++;
      imageRefs.set(b.image, {
        href: `images/img${imgN}.${ext(img.mime)}`,
        width: img.width,
        height: img.height,
        mime: img.mime,
        manifestId: `img${imgN}`,
      });
    }
  }

  const renderOpts = { pageMarkers: settings.pageMarkers, kepub: settings.kepub, language: lang, sectionsInToc: settings.sectionsInToc };
  const rendered: RenderedReading[] = ordered.map((r, i) => renderReading(r, i, renderOpts, (id) => imageRefs.get(id)));

  // Table of contents tree.
  const toc: TocNode[] = [{ label: 'Contents', href: 'text/title.xhtml', children: [] }];
  if (grouped) {
    let current: TocNode | undefined;
    let currentCourse: string | undefined;
    ordered.forEach((r, i) => {
      const course = r.course.trim() || 'Other readings';
      if (course !== currentCourse) {
        currentCourse = course;
        current = { label: course, href: rendered[i].toc.href, children: [] };
        toc.push(current);
      }
      current!.children.push(rendered[i].toc);
    });
  } else {
    toc.push(...rendered.map((r) => r.toc));
  }
  const pageTargets: PageTarget[] = rendered.flatMap((r) => r.pages);

  const zip = new ZipWriter(sink, now);
  const written: string[] = [];
  const add = async (path: string, data: Uint8Array | string, store = false) => {
    written.push(path);
    await zip.add(path, typeof data === 'string' ? utf8(data) : data, { store });
  };

  // `mimetype` must come first and be stored uncompressed.
  await add('mimetype', 'application/epub+zip', true);
  await add(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
      `<rootfiles>\n<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n</rootfiles>\n</container>\n`,
  );
  await add('OEBPS/css/style.css', STYLESHEET);

  interface ManifestItem {
    id: string;
    href: string;
    type: string;
    props?: string;
  }
  const manifest: ManifestItem[] = [
    { id: 'nav', href: 'nav.xhtml', type: 'application/xhtml+xml', props: 'nav' },
    { id: 'ncx', href: 'toc.ncx', type: 'application/x-dtbncx+xml' },
    { id: 'css', href: 'css/style.css', type: 'text/css' },
  ];
  const spine: string[] = [];

  const docOpts = { kepub: settings.kepub, cssHref: '../css/style.css' };
  if (input.cover) {
    const href = `images/cover.${ext(input.cover.mime)}`;
    await add(`OEBPS/${href}`, input.cover.data, true);
    manifest.push({ id: 'cover-image', href, type: input.cover.mime, props: 'cover-image' });
    const coverDoc = xhtmlDocument(
      settings.title,
      `<div class="cover"><img src="../${href}" alt="${esc(settings.title)}" width="${input.cover.width}" height="${input.cover.height}"/></div>`,
      lang,
      { ...docOpts, kepub: false },
    );
    await add('OEBPS/text/cover.xhtml', coverDoc);
    manifest.push({ id: 'cover', href: 'text/cover.xhtml', type: 'application/xhtml+xml' });
    spine.push('cover');
  }

  await add('OEBPS/text/title.xhtml', titlePage(settings, ordered, rendered, grouped, lang, now));
  manifest.push({ id: 'title', href: 'text/title.xhtml', type: 'application/xhtml+xml' });
  spine.push('title');

  for (const r of rendered) {
    for (const f of r.files) {
      await add(`OEBPS/${f.path}`, f.xhtml);
      manifest.push({ id: f.id, href: f.path, type: 'application/xhtml+xml' });
      spine.push(f.id);
    }
  }

  for (const [id, ref] of imageRefs) {
    const used = rendered.some((r) => r.images.has(id));
    if (!used) continue;
    const img = await input.getImage(id);
    if (!img) continue;
    await add(`OEBPS/${ref.href}`, img.data, true);
    manifest.push({ id: ref.manifestId, href: ref.href, type: ref.mime });
  }

  await add('OEBPS/nav.xhtml', navDocument(settings, toc, pageTargets, rendered, input.cover !== undefined, lang));
  await add('OEBPS/toc.ncx', ncxDocument(settings, toc, identifier));
  await add('OEBPS/content.opf', opfDocument(settings, manifest, spine, identifier, lang, now));

  await zip.finish();
  return { fileName: epubFileName(settings), bytes: zip.bytesWritten, files: written };
}

function titlePage(
  settings: BundleSettings,
  readings: Reading[],
  rendered: RenderedReading[],
  grouped: boolean,
  lang: string,
  now: Date,
): string {
  let items = '';
  let currentCourse: string | undefined;
  readings.forEach((r, i) => {
    const course = r.course.trim() || 'Other readings';
    if (grouped && course !== currentCourse) {
      currentCourse = course;
      items += `<li class="course">${esc(course)}</li>\n`;
    }
    const who = [r.author, pageRange(r)].filter(Boolean).join(' · ');
    const href = rendered[i].toc.href.replace(/^text\//, '');
    items += `<li><a href="${href}">${esc(r.title)}</a>${who ? ` <span class="who">— ${esc(who)}</span>` : ''}</li>\n`;
  });
  const count = `${readings.length} reading${readings.length === 1 ? '' : 's'}`;
  const date = now.toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' });
  const body =
    `<section class="title-page" epub:type="titlepage">\n<h1>${esc(settings.title)}</h1>\n` +
    `<p class="subtitle">${esc([settings.author, count, date].filter(Boolean).join(' · '))}</p>\n` +
    `<h2>Contents</h2>\n<ol>\n${items}</ol>\n</section>`;
  return xhtmlDocument(settings.title, body, lang, { kepub: false, cssHref: '../css/style.css' });
}

function tocList(nodes: TocNode[]): string {
  return `<ol>\n${nodes
    .map((n) => `<li><a href="${esc(n.href)}">${esc(n.label)}</a>${n.children.length ? `\n${tocList(n.children)}` : ''}</li>`)
    .join('\n')}\n</ol>`;
}

function navDocument(
  settings: BundleSettings,
  toc: TocNode[],
  pages: PageTarget[],
  rendered: RenderedReading[],
  hasCover: boolean,
  lang: string,
): string {
  const firstReading = rendered[0]?.toc.href ?? 'text/title.xhtml';
  const landmarks =
    `<nav epub:type="landmarks" id="landmarks" hidden="">\n<h2>Guide</h2>\n<ol>\n` +
    (hasCover ? `<li><a epub:type="cover" href="text/cover.xhtml">Cover</a></li>\n` : '') +
    `<li><a epub:type="toc" href="text/title.xhtml">Contents</a></li>\n` +
    `<li><a epub:type="bodymatter" href="${firstReading}">Start reading</a></li>\n</ol>\n</nav>`;
  const pageList = pages.length
    ? `<nav epub:type="page-list" id="page-list" hidden="">\n<h2>Pages</h2>\n<ol>\n${pages
        .map((p) => `<li><a href="${esc(p.href)}">${esc(p.label)}</a></li>`)
        .join('\n')}\n</ol>\n</nav>`
    : '';
  const body = `<nav epub:type="toc" id="toc" role="doc-toc">\n<h1>Contents</h1>\n${tocList(toc)}\n</nav>\n${landmarks}\n${pageList}`;
  return xhtmlDocument(settings.title, body, lang, { kepub: false, cssHref: 'css/style.css' });
}

function ncxDocument(settings: BundleSettings, toc: TocNode[], identifier: string): string {
  const order = new Map<string, number>();
  let depth = 0;
  const points = (nodes: TocNode[], level: number, prefix: string): string =>
    nodes
      .map((n, i) => {
        depth = Math.max(depth, level);
        if (!order.has(n.href)) order.set(n.href, order.size + 1);
        const id = `${prefix}${i + 1}`;
        return (
          `<navPoint id="np${id}" playOrder="${order.get(n.href)}">\n<navLabel><text>${esc(n.label)}</text></navLabel>\n` +
          `<content src="${esc(n.href)}"/>\n${points(n.children, level + 1, `${id}-`)}</navPoint>\n`
        );
      })
      .join('');
  const map = points(toc, 1, '');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n<head>\n` +
    `<meta name="dtb:uid" content="${esc(identifier)}"/>\n<meta name="dtb:depth" content="${depth}"/>\n` +
    `<meta name="dtb:totalPageCount" content="0"/>\n<meta name="dtb:maxPageNumber" content="0"/>\n</head>\n` +
    `<docTitle><text>${esc(settings.title)}</text></docTitle>\n<navMap>\n${map}</navMap>\n</ncx>\n`
  );
}

function opfDocument(
  settings: BundleSettings,
  manifest: { id: string; href: string; type: string; props?: string }[],
  spine: string[],
  identifier: string,
  lang: string,
  now: Date,
): string {
  const modified = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const items = manifest
    .map((m) => `<item id="${m.id}" href="${esc(m.href)}" media-type="${m.type}"${m.props ? ` properties="${m.props}"` : ''}/>`)
    .join('\n');
  const itemrefs = spine.map((id) => `<itemref idref="${id}"/>`).join('\n');
  const hasCover = manifest.some((m) => m.id === 'cover-image');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${esc(lang)}">\n` +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
    `<dc:identifier id="uid">${esc(identifier)}</dc:identifier>\n` +
    `<dc:title>${esc(settings.title)}</dc:title>\n` +
    `<dc:language>${esc(lang)}</dc:language>\n` +
    `<dc:creator>${esc(settings.author || 'Course readings')}</dc:creator>\n` +
    `<dc:date>${now.toISOString().slice(0, 10)}</dc:date>\n` +
    `<dc:publisher>EPUB Converter</dc:publisher>\n` +
    `<meta property="dcterms:modified">${modified}</meta>\n` +
    (hasCover ? `<meta name="cover" content="cover-image"/>\n` : '') +
    `</metadata>\n<manifest>\n${items}\n</manifest>\n<spine toc="ncx">\n${itemrefs}\n</spine>\n</package>\n`
  );
}
