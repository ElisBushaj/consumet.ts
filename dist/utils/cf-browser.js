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
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeAnimeKaiBrowser = void 0;
exports.resolveAnimeKaiIframe = resolveAnimeKaiIframe;
const M3U8_RE = /\.m3u8(\?|$)/i;
const VTT_RE = /\.vtt(\?|$)/i;
const MEGAUP_E_RE = /^https?:\/\/megaup\.[a-z]+\/e\//;
const SUB_FILENAME_LANG_RE = /\/subs\/([a-z]{2,3})_/i;
const IDLE_TEARDOWN_MS = 10 * 60 * 1000; // tear browser down after 10 min idle
const NAV_TIMEOUT_MS = 60000;
const CF_WAIT_MS = 45000;
const SOURCES_WAIT_MS = 45000;
const POST_SOURCE_GRACE_MS = 1500; // after first m3u8, wait briefly for subs to load
const POLL_MS = 250;
const DEBUG = process.env.CF_BROWSER_DEBUG === '1';
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
 * Open the iframe URL, let CF clear, capture the m3u8 + .vtt URLs the JW
 * player loads, and return them as an ISource-shaped result.
 */
async function resolveAnimeKaiIframe(iframeUrl) {
    const { page } = await getBrowser();
    const captured = { sources: [], subtitles: [] };
    const seenSources = new Set();
    const seenSubs = new Set();
    let respCount = 0;
    const responseHosts = new Set();
    const onResponse = (res) => {
        const url = res.url();
        respCount++;
        if (DEBUG) {
            try {
                responseHosts.add(new URL(url).host);
            }
            catch {
                // ignore
            }
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
        // Poll for CF challenge to clear (title changes from "Just a moment...").
        const cfDeadline = Date.now() + CF_WAIT_MS;
        let cleared = false;
        while (Date.now() < cfDeadline) {
            const title = await page.title().catch(() => '');
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
            const detail = DEBUG ? ` (responses=${respCount}, hosts=${[...responseHosts].join(',')})` : '';
            throw new Error(`No streaming sources intercepted from player${detail}`);
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