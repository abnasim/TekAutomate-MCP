/**
 * scrapeTekDocs.ts
 * Scrapes public Tektronix technical documents from tek.com and builds
 * a RAG index (tek_docs_index.json) in the same format as other corpora.
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx scripts/scrapeTekDocs.ts
 *
 * Output: mcp-server/public/rag/tek_docs_index.json
 * Then re-run: npx tsx scripts/buildRagIndex.ts  (or just update manifest manually)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(SCRIPT_DIR, '../public/rag/tek_docs_index.json');
const MANIFEST_FILE = path.resolve(SCRIPT_DIR, '../public/rag/manifest.json');
const URL_LIST_FILE = path.resolve(SCRIPT_DIR, 'tek_doc_urls.json');

// Load URL list from file if present, otherwise fall back to SEED_URLS
function loadUrls(): string[] {
  if (fs.existsSync(URL_LIST_FILE)) {
    console.log(`Loading URLs from ${URL_LIST_FILE}`);
    return JSON.parse(fs.readFileSync(URL_LIST_FILE, 'utf8')) as string[];
  }
  return SEED_URLS;
}

// ── Curated URL list ──────────────────────────────────────────────────────────
// Add more URLs here any time — just run the script again to refresh.
const SEED_URLS: string[] = [

  // ── Automation & remote control ──────────────────────────────────────────
  'https://www.tek.com/en/documents/technical-brief/getting-started-with-oscilloscope-automation-and-python',
  'https://www.tek.com/en/documents/technical-brief/enhance-productivity-with-hsi',
  'https://www.tek.com/en/documents/technical-brief/working-remotely-with-tek-scopes-tech-brief',
  'https://www.tek.com/en/documents/technical-brief/working-remotely-with-tek-scopes-with-windows-os-tech-brief',
  'https://www.tek.com/en/documents/technical-brief/pi-command-translator-on-oscilloscopes-tech-brief',
  'https://www.tek.com/en/documents/application-note/remote-control-and-access-for-the-2-series-mso-mixed-signal-oscilloscope',
  'https://www.tek.com/en/documents/application-note/automating-double-pulse-tests-with-python',
  'https://www.tek.com/en/documents/application-note/using-raspberry-pi-to-control-your-oscilloscope',
  'https://www.tek.com/en/documents/how-guide/simplifying-test-automation-with-tm_devices-and-python',
  'https://www.tek.com/en/documents/how-guide/getting-started-with-hsi-how-to-guide',

  // ── Oscilloscope fundamentals & setup ───────────────────────────────────
  'https://www.tek.com/en/documents/primer/xyzs-oscilloscopes-primer',
  'https://www.tek.com/en/documents/primer/oscilloscope-basics',
  'https://www.tek.com/en/documents/primer/oscilloscope-systems-and-controls',
  'https://www.tek.com/en/documents/primer/setting-and-using-oscilloscope',
  'https://www.tek.com/en/documents/primer/how-to-use-an-oscilloscope',
  'https://www.tek.com/en/documents/primer/evaluating-oscilloscopes',
  'https://www.tek.com/en/documents/technical-brief/floating-oscilloscope-measurements-and-operator-protection',

  // ── MSO / mixed signal ───────────────────────────────────────────────────
  'https://www.tek.com/en/documents/application-note/how-use-mixed-signal-oscilloscope-test-digital-circuits',
  'https://www.tek.com/en/documents/application-note/fundamentals-mdo4000-series-mixed-domain-oscilloscope',
  'https://www.tek.com/en/documents/application-note/using-mixed-signal-oscilloscopes-to-find-and-diagnose-jitter-caused-by-power-integrity-problems',

  // ── Serial buses & protocols ─────────────────────────────────────────────
  'https://www.tek.com/en/documents/application-note/debugging-spmi-power-management-buses-oscilloscope',
  'https://www.tek.com/en/documents/application-note/how-troubleshoot-system-problems-using-oscilloscope-i2c-and-spi-decoding',
  'https://www.tek.com/en/documents/application-note/debugging-can-lin-and-flexray-automotive-buses-oscilloscope',
  'https://www.tek.com/en/documents/application-note/debugging-sent-automotive-buses-oscilloscope',
  'https://www.tek.com/en/documents/application-note/debugging-serial-buses-embedded-system-designs-0',
  'https://www.tek.com/en/documents/application-note/analyzing-8b-10b-encoded-signals-real-time-oscilloscope',
  'https://www.tek.com/en/documents/application-note/understanding-and-performing-usb-20-physical-layer-testing',
  'https://www.tek.com/en/documents/primer/468111',
  'https://www.tek.com/en/documents/application-note/automotive-ethernet-see-true-signal',

  // ── Jitter & signal integrity ────────────────────────────────────────────
  'https://www.tek.com/en/documents/technical-brief/choose-right-platform-your-jitter-measurements',
  'https://www.tek.com/en/documents/application-note/characterizing-and-troubleshooting-jitter-your-oscilloscope',
  'https://www.tek.com/en/documents/technical-brief/jitter-testing-on-ethernet-app-note',
  'https://www.tek.com/en/documents/application-note/troubleshooting-ethernet-problems-your-oscilloscope',
  'https://www.tek.com/en/documents/primer/clock-recovery-primer-part-1',
  'https://www.tek.com/en/documents/primer/clock-recovery-primer-part-2',
  'https://www.tek.com/en/documents/primer/stressed-eye-primer',

  // ── Probing & measurement ────────────────────────────────────────────────
  'https://www.tek.com/en/documents/application-note/how-oscilloscope-probes-affect-your-measurement',
  'https://www.tek.com/en/documents/technical-brief/making-microvolt-biomedical-measurements',

  // ── Power measurements ───────────────────────────────────────────────────
  'https://www.tek.com/en/documents/technical-brief/measuring-the-control-loop-response-of-a-power-supply-using-an-oscilloscope',
  'https://www.tek.com/en/documents/application-note/getting-started-power-rail-measurements-application-note',
  'https://www.tek.com/en/documents/application-note/power-supply-application-note',
  'https://www.tek.com/en/documents/application-note/double-pulse-test-tektronix-afg31000-arbitrary-function-generator',
  'https://www.tek.com/en/documents/primer/standby-power-primer',
  'https://www.tek.com/en/documents/technical-brief/dc-power-supply-technical-information',

  // ── Spectrum & frequency domain ──────────────────────────────────────────
  'https://www.tek.com/en/documents/application-note/spectrum-view-new-approach-frequency-domain-analysis-oscilloscopes',
  'https://www.tek.com/en/documents/whitepaper/comparing-traditional-oscilloscope-fft-to-spectrum-view-analysis-power-supply-control-loop',
  'https://www.tek.com/en/documents/primer/fundamentals-real-time-spectrum-analysis',
  'https://www.tek.com/en/documents/primer/dpx-acquisition-technology-spectrum-analyzers-fundamentals',
  'https://www.tek.com/en/documents/primer/fundamentals-radar-measurements',

  // ── Triggering & acquisition ─────────────────────────────────────────────
  'https://www.tek.com/en/documents/technical-brief/visual-triggers-graphical-methods-capturing-bursts-and-other-complex',

  // ── EMI / RF ─────────────────────────────────────────────────────────────
  'https://www.tek.com/en/documents/application-note/practical-emi-troubleshooting',
  'https://www.tek.com/en/documents/application-note/interference-hunting-application-note',

  // ── TDR / signal propagation ─────────────────────────────────────────────
  'https://www.tek.com/en/documents/primer/tdr-test',
  'https://www.tek.com/en/documents/primer/understanding-and-applying-time-domain-reflectometry-tdr-using-real-time-oscilloscopes',

  // ── High-speed / PCIe / compliance ──────────────────────────────────────
  'https://www.tek.com/en/documents/technical-brief/pcie-gen-5-tx-tech-brief',
  'https://www.tek.com/en/documents/application-note/overcoming-receiver-test-challenges-gen4-i-o-applications',
  'https://www.tek.com/en/documents/application-note/physical-layer-compliance-testing-hdmi-using-tdsht3-hdmi-compliance-test-s',

  // ── Misc ─────────────────────────────────────────────────────────────────
  'https://www.tek.com/en/documents/technical-brief/tekscope-pc-software-installation-guide',
];

// ── Types ─────────────────────────────────────────────────────────────────────
interface RagChunk {
  id: string;
  corpus: string;
  title: string;
  body: string;
  tags: string[];
  source: string;
}

// ── HTML text extraction ──────────────────────────────────────────────────────
/**
 * Strips HTML tags and decodes common entities.
 * Works well enough for tek.com's server-rendered article pages.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Extracts the main article text from tek.com document pages.
 * These pages embed full article HTML in the page body.
 */
function extractArticleText(html: string): { title: string; body: string } {
  // Page title
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const rawTitle = titleMatch ? stripHtml(titleMatch[1]) : '';

  // Try to find the main article container — tek.com uses various class names
  const articlePatterns = [
    /<article[\s\S]*?>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*(?:content|article|body|main|document)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*resource-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];

  let rawBody = '';
  for (const pattern of articlePatterns) {
    const match = html.match(pattern);
    if (match && match[1].length > 500) {
      rawBody = match[1];
      break;
    }
  }

  // Fallback: strip entire body
  if (!rawBody) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    rawBody = bodyMatch ? bodyMatch[1] : html;
  }

  const body = stripHtml(rawBody)
    .replace(/\s{3,}/g, '\n\n')
    .trim();

  return { title: rawTitle, body };
}

/**
 * Splits a long text into chunks of ~400 words with a 50-word overlap.
 */
function chunkText(text: string, maxWords = 400, overlap = 50): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length);
    chunks.push(words.slice(start, end).join(' '));
    start += maxWords - overlap;
    if (end === words.length) break;
  }
  return chunks;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

// ── Fetcher ───────────────────────────────────────────────────────────────────
async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TekAutomate-RAG-Scraper/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`  ✗ HTTP ${res.status} — skipping`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`  ✗ Fetch error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const urls = loadUrls();
  console.log(`Scraping ${urls.length} tek.com document URLs…\n`);

  const chunks: RagChunk[] = [];
  const seen = new Set<string>();

  for (const url of urls) {
    const slug = url.split('/').pop() || 'unknown';
    console.log(`→ ${slug}`);

    const html = await fetchPage(url);
    if (!html) continue;

    const { title, body } = extractArticleText(html);
    if (body.length < 200) {
      console.warn('  ✗ Extracted body too short — skipping');
      continue;
    }

    const docSlug = slugify(slug);
    const docType = url.includes('/technical-brief/') ? 'technical-brief'
      : url.includes('/application-note/') ? 'application-note'
      : url.includes('/primer/') ? 'primer'
      : url.includes('/white-paper/') ? 'white-paper'
      : 'document';

    const textChunks = chunkText(body);
    console.log(`  ✓ "${title || slug}" — ${body.length} chars → ${textChunks.length} chunk(s)`);

    textChunks.forEach((chunkBody, i) => {
      const id = `tek_${docSlug}_p${i + 1}`;
      if (seen.has(id)) return;
      seen.add(id);
      chunks.push({
        id,
        corpus: 'tek_docs',
        title: title || slug,
        body: chunkBody,
        tags: [docSlug, docType, 'tektronix', 'tek_com'],
        source: url,
      });
    });

    // Polite delay
    await new Promise(r => setTimeout(r, 800));
  }

  if (chunks.length === 0) {
    console.error('\nNo chunks produced — nothing to write.');
    process.exit(1);
  }

  // Write index
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(chunks, null, 2), 'utf8');
  console.log(`\n✅ Wrote ${chunks.length} chunks → ${OUT_FILE}`);

  // Update manifest
  if (fs.existsSync(MANIFEST_FILE)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    manifest.corpora = manifest.corpora || {};
    manifest.counts = manifest.counts || {};
    manifest.corpora['tek_docs'] = 'tek_docs_index.json';
    manifest.counts['tek_docs'] = chunks.length;
    manifest.generatedAt = new Date().toISOString();
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`✅ Updated manifest (${chunks.length} tek_docs chunks)`);
  }

  console.log('\nDone! Restart the MCP server to load the new corpus.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
