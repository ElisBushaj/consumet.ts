"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeAnimeKaiBrowser = void 0;
exports.resolveAnimeKaiIframeHttp = resolveAnimeKaiIframeHttp;
exports.resolveAnimeKaiIframe = resolveAnimeKaiIframe;
exports.resolveAnimeKaiIframeBrowser = resolveAnimeKaiIframeBrowser;
const axios_1 = __importDefault(require("axios"));
const extractors_1 = require("../extractors");
const MEGAUP_IFRAME_RE = /<iframe[^>]+src=["']([^"']*megaup\.[a-z]+\/e\/[^"'?]+)/i;
const IFRAME_FETCH_TIMEOUT_MS = 10000;
const M3U8_RE = /\.m3u8(\?|$)/i;
const VTT_RE = /\.vtt(\?|$)/i;
const MEGAUP_E_RE = /^https?:\/\/megaup\.[a-z]+\/e\//;
const SUB_FILENAME_LANG_RE = /\/subs\/([a-z]{2,3})_/i;
const IDLE_TEARDOWN_MS = 10 * 60 * 1000; // tear browser down after 10 min idle
const NAV_TIMEOUT_MS = numFromEnv('ANIMEKAI_NAV_TIMEOUT_MS', 60000);
const CF_WAIT_MS = numFromEnv('ANIMEKAI_CF_WAIT_MS', 10000);
const SOURCES_WAIT_MS = numFromEnv('ANIMEKAI_SOURCES_WAIT_MS', 10000);
const POST_SOURCE_GRACE_MS = 1500; // after first m3u8, wait briefly for subs to load
const POLL_MS = 250;
const DEBUG = process.env.CF_BROWSER_DEBUG === '1';
function numFromEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
let browserPromise = null;
let idleTimer = null;
let exitHandlersRegistered = false;
function registerExitHandlers() {
    if (exitHandlersRegistered)
        return;
    exitHandlersRegistered = true;
    // puppeteer-real-browser launches Chrome detached, so the child outlives
    // the Node process unless we explicitly close it on signals.
    const onSignal = (signal) => {
        void teardownBrowser().finally(() => {
            process.kill(process.pid, signal);
        });
    };
    process.once('SIGINT', () => onSignal('SIGINT'));
    process.once('SIGTERM', () => onSignal('SIGTERM'));
    process.once('SIGHUP', () => onSignal('SIGHUP'));
}
async function getBrowser() {
    if (browserPromise)
        return browserPromise;
    registerExitHandlers();
    browserPromise = (async () => {
        let connect;
        try {
            ({ connect } = await Promise.resolve().then(() => __importStar(require('puppeteer-real-browser'))));
        }
        catch (err) {
            browserPromise = null;
            throw new Error('AnimeKai /watch requires puppeteer-real-browser to bypass Cloudflare. ' +
                'Install with `npm i puppeteer-real-browser` (and ensure Google Chrome is available on the system).');
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
    if (idleTimer)
        clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        void teardownBrowser();
    }, IDLE_TEARDOWN_MS);
    // Don't keep the event loop alive just for this timer.
    if (typeof idleTimer.unref === 'function')
        idleTimer.unref();
}
async function teardownBrowser() {
    const p = browserPromise;
    browserPromise = null;
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    if (!p)
        return;
    try {
        const { browser } = await p;
        await browser.close();
    }
    catch {
        // ignore
    }
}
function langFromSubUrl(url) {
    const m = url.match(SUB_FILENAME_LANG_RE);
    return m ? m[1] : 'unknown';
}
/**
 * HTTP-only resolution: fetch the /iframe page (a tiny stub) directly, extract
 * the embedded megaup.<tld>/e/<id> URL, and run the MegaUp extractor on it.
 *
 * Works without a browser, so this is the default path on Vercel and other
 * headless environments. If Cloudflare ever fronts the /iframe wrapper with
 * a real challenge, this will throw and callers can opt in to the browser
 * path with `ANIMEKAI_USE_BROWSER=1`.
 */
async function resolveAnimeKaiIframeHttp(iframeUrl) {
    const { data: html } = await axios_1.default.get(iframeUrl, {
        timeout: IFRAME_FETCH_TIMEOUT_MS,
        responseType: 'text',
        transformResponse: r => r,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: 'https://anikai.to/',
        },
    });
    const m = MEGAUP_IFRAME_RE.exec(typeof html === 'string' ? html : String(html));
    if (!m) {
        throw new Error('AnimeKai iframe: could not locate megaup URL (possibly behind a Cloudflare challenge; ' +
            'set ANIMEKAI_USE_BROWSER=1 to fall back to puppeteer-real-browser).');
    }
    const megaupUrl = new URL(m[1]);
    const extracted = await new extractors_1.MegaUp().extract(megaupUrl);
    return {
        sources: extracted.sources ?? [],
        subtitles: extracted.subtitles ?? [],
    };
}
/**
 * Default entry point. Tries the HTTP path first; only falls back to the
 * heavyweight browser path when explicitly enabled (`ANIMEKAI_USE_BROWSER=1`).
 *
 * This keeps Vercel-style deploys fast and predictable while still giving
 * power users an opt-in escape hatch for the rare case where Cloudflare
 * starts gating the /iframe wrapper itself.
 */
async function resolveAnimeKaiIframe(iframeUrl) {
    try {
        return await resolveAnimeKaiIframeHttp(iframeUrl);
    }
    catch (err) {
        if (process.env.ANIMEKAI_USE_BROWSER !== '1')
            throw err;
        if (DEBUG) {
            console.error('[cf-browser] HTTP fallback failed, escalating to puppeteer-real-browser:', err.message);
        }
        return resolveAnimeKaiIframeBrowser(iframeUrl);
    }
}
/**
 * Open the iframe URL in a real browser, let CF clear, capture the m3u8 + .vtt
 * URLs the JW player loads, and return them as an ISource-shaped result.
 */
async function resolveAnimeKaiIframeBrowser(iframeUrl) {
    const { page } = await getBrowser();
    const captured = { sources: [], subtitles: [] };
    const seenSources = new Set();
    const seenSubs = new Set();
    let respCount = 0;
    const responseHosts = new Map();
    const allResponseUrls = [];
    const onResponse = (res) => {
        const url = res.url();
        respCount++;
        if (DEBUG) {
            try {
                const host = new URL(url).host;
                responseHosts.set(host, (responseHosts.get(host) || 0) + 1);
            }
            catch {
                // ignore
            }
            if (allResponseUrls.length < 80)
                allResponseUrls.push(`${res.status()} ${url}`);
        }
        if (M3U8_RE.test(url) && !seenSources.has(url)) {
            seenSources.add(url);
            captured.sources.push({ url, isM3U8: true });
        }
        else if (VTT_RE.test(url) && /\/subs\//.test(url) && !seenSubs.has(url)) {
            seenSubs.add(url);
            captured.subtitles.push({ url, lang: langFromSubUrl(url) });
        }
    };
    page.on('response', onResponse);
    try {
        try {
            await page.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        }
        catch (err) {
            throw new Error(`Failed to navigate to iframe URL: ${err.message}`);
        }
        // The page may briefly change title during the CF redirect dance, so
        // checking title alone is unreliable. The player only contacts megaup
        // after CF clears, so "we've seen any megaup.* response" is a stronger
        // signal that the challenge passed. Combine both signals: keep going
        // until we either capture an m3u8 or hit the deadline.
        const deadline = Date.now() + CF_WAIT_MS + SOURCES_WAIT_MS;
        while (Date.now() < deadline && captured.sources.length === 0) {
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
                for (const u of allResponseUrls)
                    console.error('  ', u);
            }
            throw new Error('No streaming sources intercepted from player');
        }
        // The player loads subtitle .vtt files shortly after the m3u8. Give them
        // a moment to arrive — without this grace period, warm requests exit
        // before any .vtt is seen.
        await new Promise(r => setTimeout(r, POST_SOURCE_GRACE_MS));
    }
    finally {
        page.off('response', onResponse);
        bumpIdleTimer();
    }
    return captured;
}
/** Allow callers to explicitly tear down on shutdown. */
exports.closeAnimeKaiBrowser = teardownBrowser;
//# sourceMappingURL=cf-browser.js.map