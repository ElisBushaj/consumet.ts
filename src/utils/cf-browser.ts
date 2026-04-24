import { ISource, ISubtitle, IVideo, Intro } from '../models/types';

/**
 * Resolves an anikai.to /iframe/<token> URL to playable video sources by
 * driving a real Chrome browser through Cloudflare's challenge and
 * intercepting the megaup network calls the player makes.
 *
 * The browser is launched lazily on first call and reused across requests:
 * after CF issues the cf_clearance cookie, subsequent calls skip the
 * challenge entirely (~1s vs ~6.5s cold).
 *
 * Requires `puppeteer-real-browser` (optionalDependency) and a system Chrome
 * binary. On headless servers, also requires xvfb to provide a display.
 */

type ResolveResult = { sources: IVideo[]; subtitles: ISubtitle[] };

const M3U8_RE = /\.m3u8(\?|$)/i;
const VTT_RE = /\.vtt(\?|$)/i;
const MEGAUP_E_RE = /^https?:\/\/megaup\.[a-z]+\/e\//;
const SUB_FILENAME_LANG_RE = /\/subs\/([a-z]{2,3})_/i;

const IDLE_TEARDOWN_MS = 10 * 60 * 1000; // tear browser down after 10 min idle
const NAV_TIMEOUT_MS = 60_000;
const CF_WAIT_MS = 45_000;
const SOURCES_WAIT_MS = 45_000;
const POST_SOURCE_GRACE_MS = 1_500; // after first m3u8, wait briefly for subs to load
const POLL_MS = 250;
const DEBUG = process.env.CF_BROWSER_DEBUG === '1';

let browserPromise: Promise<{ browser: any; page: any }> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let exitHandlersRegistered = false;

function registerExitHandlers(): void {
  if (exitHandlersRegistered) return;
  exitHandlersRegistered = true;

  // puppeteer-real-browser launches Chrome detached, so the child outlives
  // the Node process unless we explicitly close it on signals.
  const onSignal = (signal: NodeJS.Signals) => {
    void teardownBrowser().finally(() => {
      process.kill(process.pid, signal);
    });
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  process.once('SIGHUP', () => onSignal('SIGHUP'));
}

async function getBrowser(): Promise<{ browser: any; page: any }> {
  if (browserPromise) return browserPromise;
  registerExitHandlers();

  browserPromise = (async () => {
    let connect: any;
    try {
      ({ connect } = await import('puppeteer-real-browser'));
    } catch (err) {
      browserPromise = null;
      throw new Error(
        'AnimeKai /watch requires puppeteer-real-browser to bypass Cloudflare. ' +
          'Install with `npm i puppeteer-real-browser` (and ensure Google Chrome is available on the system).'
      );
    }

    const { browser, page } = await connect({
      headless: false,
      fingerprint: true,
      turnstile: true,
      args: ['--window-size=1280,800'],
    });
    return { browser, page };
  })();

  return browserPromise;
}

function bumpIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void teardownBrowser();
  }, IDLE_TEARDOWN_MS);
  // Don't keep the event loop alive just for this timer.
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
}

async function teardownBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!p) return;
  try {
    const { browser } = await p;
    await browser.close();
  } catch {
    // ignore
  }
}

function langFromSubUrl(url: string): string {
  const m = url.match(SUB_FILENAME_LANG_RE);
  return m ? m[1] : 'unknown';
}

/**
 * Open the iframe URL, let CF clear, capture the m3u8 + .vtt URLs the JW
 * player loads, and return them as an ISource-shaped result.
 */
export async function resolveAnimeKaiIframe(iframeUrl: string): Promise<ResolveResult> {
  const { page } = await getBrowser();

  const captured: ResolveResult = { sources: [], subtitles: [] };
  const seenSources = new Set<string>();
  const seenSubs = new Set<string>();

  let respCount = 0;
  const responseHosts = new Map<string, number>();
  const allResponseUrls: string[] = [];
  const onResponse = (res: any) => {
    const url: string = res.url();
    respCount++;
    if (DEBUG) {
      try {
        const host = new URL(url).host;
        responseHosts.set(host, (responseHosts.get(host) || 0) + 1);
      } catch {
        // ignore
      }
      if (allResponseUrls.length < 80) allResponseUrls.push(`${res.status()} ${url}`);
    }
    if (M3U8_RE.test(url) && !seenSources.has(url)) {
      seenSources.add(url);
      captured.sources.push({ url, isM3U8: true });
    } else if (VTT_RE.test(url) && /\/subs\//.test(url) && !seenSubs.has(url)) {
      seenSubs.add(url);
      captured.subtitles.push({ url, lang: langFromSubUrl(url) });
    }
  };

  page.on('response', onResponse);
  try {
    try {
      await page.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      throw new Error(`Failed to navigate to iframe URL: ${(err as Error).message}`);
    }

    // Poll for CF challenge to clear (title changes from "Just a moment...").
    const cfDeadline = Date.now() + CF_WAIT_MS;
    let cleared = false;
    while (Date.now() < cfDeadline) {
      const title: string = await page.title().catch(() => '');
      if (!/Just a moment/i.test(title)) {
        cleared = true;
        break;
      }
      await new Promise(r => setTimeout(r, POLL_MS));
    }
    if (!cleared) {
      throw new Error('Cloudflare challenge did not clear within timeout');
    }

    // Wait for the master m3u8 to be intercepted.
    const sourcesDeadline = Date.now() + SOURCES_WAIT_MS;
    while (Date.now() < sourcesDeadline && captured.sources.length === 0) {
      await new Promise(r => setTimeout(r, POLL_MS));
    }
    if (captured.sources.length === 0) {
      if (DEBUG) {
        const title = await page.title().catch(() => '');
        const url = page.url();
        const hostSummary = [...responseHosts.entries()].map(([h, n]) => `${h}=${n}`).join(', ');
        console.error('[cf-browser] no-sources diagnostic:', {
          title,
          url,
          respCount,
          hosts: hostSummary,
        });
        console.error('[cf-browser] all captured response urls:');
        for (const u of allResponseUrls) console.error('  ', u);
      }
      throw new Error('No streaming sources intercepted from player');
    }

    // The player loads subtitle .vtt files shortly after the m3u8. Give them
    // a moment to arrive — without this grace period, warm requests exit
    // before any .vtt is seen.
    await new Promise(r => setTimeout(r, POST_SOURCE_GRACE_MS));
  } finally {
    page.off('response', onResponse);
    bumpIdleTimer();
  }

  return captured;
}

/** Allow callers to explicitly tear down on shutdown. */
export const closeAnimeKaiBrowser = teardownBrowser;
