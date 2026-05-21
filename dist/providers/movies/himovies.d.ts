import { AxiosAdapter } from 'axios';
import { MovieParser, ProxyConfig, TvType, IMovieInfo, IEpisodeServer, StreamingServers, ISource, IMovieResult, ISearch } from '../../models';
declare class HiMovies extends MovieParser {
    readonly name = "HiMovies";
    protected baseUrl: string;
    protected logo: string;
    protected classPath: string;
    supportedTypes: Set<TvType>;
    private static readonly NAV_SELECTOR;
    constructor(proxyConfig?: ProxyConfig, adapter?: AxiosAdapter);
    /**
     * Normalize an anchor `href` (relative `/foo/bar` or absolute `https://host/foo/bar`)
     * to a relative id like `foo/bar`. Returns '' for missing/empty hrefs.
     */
    private idFromHref;
    /**
     * Build a fully-qualified url from an anchor `href`, regardless of whether
     * the href is already absolute or relative to the site root.
     */
    private urlFromHref;
    /**
     * Search for movies and TV shows
     * @param query search query string
     * @param page page number (default: 1)
     */
    search: (query: string, page?: number) => Promise<ISearch<IMovieResult>>;
    /**
     * Fetch detailed information about a movie or TV show
     * @param mediaId media link or id
     */
    fetchMediaInfo: (mediaId: string) => Promise<IMovieInfo>;
    /**
     * Fetch available streaming servers for an episode
     * @param episodeId episode link or id
     * @param mediaId movie/tv show link or id
     */
    fetchEpisodeServers: (episodeId: string, mediaId: string) => Promise<IEpisodeServer[]>;
    /**
     * Fetch streaming sources for an episode
     * @param episodeId episode id or full URL
     * @param mediaId media id
     * @param server streaming server type (default: MegaCloud)
     */
    fetchEpisodeSources: (episodeId: string, mediaId: string, server?: StreamingServers) => Promise<ISource>;
    /**
     * Fetch recent movies from home page
     */
    fetchRecentMovies: () => Promise<IMovieResult[]>;
    /**
     * Fetch recent TV shows from home page
     */
    fetchRecentTvShows: () => Promise<IMovieResult[]>;
    /**
     * Fetch trending movies from home page
     */
    fetchTrendingMovies: () => Promise<IMovieResult[]>;
    /**
     * Fetch trending TV shows from home page
     */
    fetchTrendingTvShows: () => Promise<IMovieResult[]>;
    /**
     * Fetch content by country
     * @param country country name
     * @param page page number (default: 1)
     */
    fetchByCountry: (country: string, page?: number) => Promise<ISearch<IMovieResult>>;
    /**
     * Fetch content by genre
     * @param genre genre name
     * @param page page number (default: 1)
     */
    fetchByGenre: (genre: string, page?: number) => Promise<ISearch<IMovieResult>>;
    /**
     * Fetch spotlight/featured content from the home page swiper.
     *
     * HiMovies shares the same SSR template as SFlix; the swiper-slide selectors
     * here mirror {@link SFlix.fetchSpotlight} so the two providers can be used
     * interchangeably as primary/fallback for a `spotlight` route.
     *
     * Note: as of 2026 the himovies.bz homepage no longer renders the original
     * `div.swiper-slide` hero carousel, so this method can legitimately return
     * an empty `results` array. Update the selectors if the layout is restored.
     */
    fetchSpotlight: () => Promise<ISearch<IMovieResult>>;
    /**
     * Fetch TV series episodes for all seasons
     * @param uid unique identifier
     */
    private fetchTvSeriesEpisodes;
    /**
     * Parse recommendations from media info page
     * @param $ cheerio instance
     */
    private parseRecommendations;
    /**
     * Fetch content from home page by section title
     * @param sectionTitle section title to search for
     * @param isTvShow whether content is TV shows
     */
    private fetchHomeSection;
    /**
     * Fetch content from home page by div ID
     * @param divId div ID to search for
     * @param isTvShow whether content is TV shows
     */
    private fetchHomeSectionById;
    /**
     * Fetch content by filter (genre or country)
     * @param filterType filter type (genre or country)
     * @param filterValue filter value
     * @param page page number
     */
    private fetchByFilter;
    /**
     * Extract sources from a streaming-server iframe URL.
     *
     * Dispatch is by **hostname**, not by the requested `StreamingServers` enum,
     * because himovies.bz's three "upcloud / akcloud / megacloud" labels all
     * resolve to *different* third-party players (vidfast.pro, vixsrc.to,
     * primesrc.me as of 2026) — the user-facing label doesn't predict the
     * player technology behind it. The `server` argument is kept for backward
     * compatibility but only used as a tie-breaker for legacy MegaCloud hosts.
     */
    private extractFromServer;
    /**
     * Parse media type from text
     * @param typeText type text to parse
     */
    private parseMediaType;
}
export default HiMovies;
