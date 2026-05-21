import axios, { AxiosAdapter } from 'axios';
import { ISource, ISubtitle, IVideo, ProxyConfig, VideoExtractor } from '../models';

/**
 * VixSrc embed extractor.
 *
 * The himovies / sflix family routes its "akcloud" server to
 * `https://vixsrc.to/{movie|tv}/<tmdbId>(/<season>/<episode>)`. VixSrc is a
 * Next.js SPA that resolves the embed in two steps:
 *
 *   1. `GET /api/{movie|tv}/<tmdbId>(/<season>/<episode>)` →
 *      `{ src: "/embed/<vixsrcId>?token=...&expires=...&t=...&..." }`
 *   2. `GET <embedUrl>` returns an HTML page where the JWPlayer config is
 *      inlined as `window.masterPlaylist = { params: { token, expires, ... },
 *      url: "https://vixsrc.to/playlist/<vixsrcId>" }`.
 *
 * Calling that playlist URL with `?token&expires&h=1` and the embed URL as
 * Referer yields the master m3u8 (HLS with English/Italian audio renditions
 * and per-language subtitle tracks). No browser, no decryption.
 */

const BASE = 'https://vixsrc.to';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MASTER_TOKEN_RE = /window\.masterPlaylist\s*=\s*\{[\s\S]*?'token'\s*:\s*'([^']+)'/;
const MASTER_EXPIRES_RE = /window\.masterPlaylist\s*=\s*\{[\s\S]*?'expires'\s*:\s*'([^']+)'/;
const MASTER_URL_RE = /window\.masterPlaylist\s*=\s*\{[\s\S]*?url\s*:\s*'([^']+)'/;
const THUMBNAILS_RE = /window\.thumbnailsUrl\s*=\s*'([^']+)'/;

// Capture a path of /movie/<tmdb> or /tv/<tmdb>/<season>/<episode>. We accept
// any number of trailing path parts so the extractor stays forward-compatible
// if VixSrc adds more granularity (e.g. languages).
const VIXSRC_PATH_RE = /^\/(movie|tv)\/(\d+)((?:\/\d+){0,3})\/?$/;

export class VixSrc extends VideoExtractor {
  protected override serverName = 'VixSrc';
  protected override sources: IVideo[] = [];

  constructor(proxyConfig?: ProxyConfig, adapter?: AxiosAdapter) {
    super(proxyConfig, adapter);
  }

  override extract = async (videoUrl: URL): Promise<ISource> => {
    const apiPath = this.toApiPath(videoUrl);
    if (!apiPath) {
      throw new Error(`VixSrc: unsupported embed URL ${videoUrl.href}`);
    }

    // Step 1: resolve TMDB id → vixsrc embed URL
    const apiResp = await axios.get<{ src?: string; error?: string }>(`${BASE}${apiPath}`, {
      timeout: 10_000,
      headers: {
        'User-Agent': USER_AGENT,
        Referer: videoUrl.href,
        Accept: 'application/json, text/plain, */*',
      },
    });

    const src = apiResp.data?.src;
    if (!src) {
      throw new Error(`VixSrc: no src returned from ${apiPath}`);
    }
    const embedUrl = src.startsWith('http') ? src : `${BASE}${src}`;

    // Step 2: fetch the embed page and pull masterPlaylist params from window.*
    const { data: embedHtml } = await axios.get<string>(embedUrl, {
      timeout: 10_000,
      responseType: 'text',
      transformResponse: r => r,
      headers: {
        'User-Agent': USER_AGENT,
        Referer: videoUrl.href,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const html = typeof embedHtml === 'string' ? embedHtml : String(embedHtml);
    const tokenMatch = MASTER_TOKEN_RE.exec(html);
    const expiresMatch = MASTER_EXPIRES_RE.exec(html);
    const playlistMatch = MASTER_URL_RE.exec(html);
    if (!tokenMatch || !expiresMatch || !playlistMatch) {
      throw new Error('VixSrc: failed to parse masterPlaylist from embed page');
    }

    const playlistUrl = new URL(playlistMatch[1]);
    playlistUrl.searchParams.set('token', tokenMatch[1]);
    playlistUrl.searchParams.set('expires', expiresMatch[1]);
    // h=1 mirrors the JWPlayer config — without it the CDN returns 403.
    // Do NOT add b=1: it's an FHD bitrate flag the player sets dynamically
    // after manifest negotiation, and including it up-front trips the edge
    // server's anti-replay check.
    playlistUrl.searchParams.set('h', '1');

    // The master playlist exposes ABR renditions internally; we return a
    // single ISource entry pointing at the master so the consuming player can
    // pick a rendition itself. Subtitles are listed inside the manifest, so we
    // also parse them out for clients that need pre-resolved tracks.
    const subtitles = this.parseSubtitles(html);
    const thumbnails = THUMBNAILS_RE.exec(html)?.[1];

    const source: ISource = {
      headers: {
        Referer: embedUrl,
        Origin: BASE,
        'User-Agent': USER_AGENT,
      },
      sources: [
        {
          url: playlistUrl.toString(),
          quality: 'auto',
          isM3U8: true,
        },
      ],
      subtitles,
    };
    if (thumbnails) {
      (source as any).thumbnails = thumbnails;
    }
    return source;
  };

  private toApiPath(videoUrl: URL): string | null {
    if (!videoUrl.hostname.endsWith('vixsrc.to')) return null;
    const m = VIXSRC_PATH_RE.exec(videoUrl.pathname);
    if (!m) return null;
    const [, kind, tmdb, rest] = m;
    return `/api/${kind}/${tmdb}${rest || ''}`;
  }

  /**
   * The embed HTML duplicates subtitle URLs in a `window.video.subtitles`-ish
   * shape *and* inside the master m3u8. We parse the EXT-X-MEDIA TYPE=SUBTITLES
   * lines off the cheap source-of-truth: a quick regex over the embed HTML's
   * inlined player config.
   */
  private parseSubtitles(html: string): ISubtitle[] {
    const out: ISubtitle[] = [];
    const subSection = /window\.subtitles\s*=\s*(\[[\s\S]*?\])/.exec(html);
    if (!subSection) return out;
    try {
      const parsed = JSON.parse(subSection[1]) as Array<{ url: string; language?: string; label?: string }>;
      for (const s of parsed) {
        if (!s?.url) continue;
        out.push({ url: s.url, lang: s.language || s.label || 'unknown' });
      }
    } catch {
      // ignore — subtitles are best-effort
    }
    return out;
  }
}

export default VixSrc;
