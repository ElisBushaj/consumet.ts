import { AxiosAdapter } from 'axios';
import { ISource, IVideo, ProxyConfig, VideoExtractor } from '../models';
export declare class VixSrc extends VideoExtractor {
    protected serverName: string;
    protected sources: IVideo[];
    constructor(proxyConfig?: ProxyConfig, adapter?: AxiosAdapter);
    extract: (videoUrl: URL) => Promise<ISource>;
    private toApiPath;
    /**
     * The embed HTML duplicates subtitle URLs in a `window.video.subtitles`-ish
     * shape *and* inside the master m3u8. We parse the EXT-X-MEDIA TYPE=SUBTITLES
     * lines off the cheap source-of-truth: a quick regex over the embed HTML's
     * inlined player config.
     */
    private parseSubtitles;
}
export default VixSrc;
