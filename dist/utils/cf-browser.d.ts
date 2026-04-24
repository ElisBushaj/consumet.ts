import { ISubtitle, IVideo } from '../models/types';
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
type ResolveResult = {
    sources: IVideo[];
    subtitles: ISubtitle[];
};
declare function teardownBrowser(): Promise<void>;
/**
 * Open the iframe URL, let CF clear, capture the m3u8 + .vtt URLs the JW
 * player loads, and return them as an ISource-shaped result.
 */
export declare function resolveAnimeKaiIframe(iframeUrl: string): Promise<ResolveResult>;
/** Allow callers to explicitly tear down on shutdown. */
export declare const closeAnimeKaiBrowser: typeof teardownBrowser;
export {};
