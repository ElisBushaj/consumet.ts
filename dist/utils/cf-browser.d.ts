import { ISubtitle, IVideo } from '../models/types';
/**
 * Resolves an anikai.to /iframe/<token> URL to playable video sources.
 *
 * Two resolution paths are available:
 *
 * 1. {@link resolveAnimeKaiIframeHttp} — a pure-HTTP path that fetches the
 *    /iframe page, extracts the inner megaup.<tld>/e/<id> URL from the stub
 *    HTML, and runs the {@link MegaUp} extractor. This works in headless
 *    environments (Vercel, container CI) where a browser cannot run.
 *
 * 2. {@link resolveAnimeKaiIframeBrowser} — drives a real Chrome browser via
 *    `puppeteer-real-browser` to bypass Cloudflare challenges and intercept
 *    the megaup network calls the player makes. Only useful when the HTTP
 *    path is blocked by CF. Requires the `puppeteer-real-browser`
 *    optionalDependency and a system Chrome binary; on headless Linux,
 *    `xvfb` must also be installed to provide a display.
 *
 * {@link resolveAnimeKaiIframe} is the default entry point: it tries the HTTP
 * path first, and only escalates to the browser path when
 * `ANIMEKAI_USE_BROWSER=1` is set in the environment.
 */
type ResolveResult = {
    sources: IVideo[];
    subtitles: ISubtitle[];
};
declare function teardownBrowser(): Promise<void>;
/**
 * HTTP-only resolution: fetch the /iframe page (a tiny stub) directly, extract
 * the embedded megaup.<tld>/e/<id> URL, and run the MegaUp extractor on it.
 *
 * Works without a browser, so this is the default path on Vercel and other
 * headless environments. If Cloudflare ever fronts the /iframe wrapper with
 * a real challenge, this will throw and callers can opt in to the browser
 * path with `ANIMEKAI_USE_BROWSER=1`.
 */
export declare function resolveAnimeKaiIframeHttp(iframeUrl: string): Promise<ResolveResult>;
/**
 * Default entry point. Tries the HTTP path first; only falls back to the
 * heavyweight browser path when explicitly enabled (`ANIMEKAI_USE_BROWSER=1`).
 *
 * This keeps Vercel-style deploys fast and predictable while still giving
 * power users an opt-in escape hatch for the rare case where Cloudflare
 * starts gating the /iframe wrapper itself.
 */
export declare function resolveAnimeKaiIframe(iframeUrl: string): Promise<ResolveResult>;
/**
 * Open the iframe URL in a real browser, let CF clear, capture the m3u8 + .vtt
 * URLs the JW player loads, and return them as an ISource-shaped result.
 */
export declare function resolveAnimeKaiIframeBrowser(iframeUrl: string): Promise<ResolveResult>;
/** Allow callers to explicitly tear down on shutdown. */
export declare const closeAnimeKaiBrowser: typeof teardownBrowser;
export {};
