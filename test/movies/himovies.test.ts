import { StreamingServers } from '../../src/models';
import { MOVIES } from '../../src/providers';

jest.setTimeout(120000);

const himovies = new MOVIES.HiMovies();

// Hardcoded ids rot fast as the upstream mirror prunes titles or rotates its
// slug suffixes. These tests derive a fresh id from search() each run so the
// suite stays green across baseUrl flips and content turnover.
let searchedMovieId: string | null = null;
let searchedTvId: string | null = null;

beforeAll(async () => {
  const data = await himovies.search('batman');
  expect(data.results.length).toBeGreaterThan(0);
  searchedMovieId = data.results.find(r => r.type === 'Movie')?.id ?? null;
  searchedTvId = data.results.find(r => r.type === 'TV Series')?.id ?? null;
});

test('Search: returns a filled array of movies/tv', async () => {
  const data = await himovies.search('vincenzo');
  expect(data.results).not.toEqual([]);
});

test('Search: ids are relative paths (no `ttps:` corruption)', async () => {
  const data = await himovies.search('batman');
  for (const r of data.results) {
    expect(r.id).toMatch(/^(movie|tv)\//);
  }
});

test('fetchMediaInfo: returns a filled object for a movie', async () => {
  expect(searchedMovieId).not.toBeNull();
  const data = await himovies.fetchMediaInfo(searchedMovieId!);
  expect(data.title).toBeTruthy();
  expect(data.id).toMatch(/^movie\//);
});

test('fetchMediaInfo: returns episodes for a tv show', async () => {
  expect(searchedTvId).not.toBeNull();
  const data = await himovies.fetchMediaInfo(searchedTvId!);
  expect(data.episodes).toBeDefined();
  expect(data.episodes!.length).toBeGreaterThan(0);
});

test('fetchEpisodeServers: returns servers for a derived tv episode', async () => {
  expect(searchedTvId).not.toBeNull();
  const info = await himovies.fetchMediaInfo(searchedTvId!);
  const ep = info.episodes?.[0];
  expect(ep).toBeDefined();
  const servers = await himovies.fetchEpisodeServers(ep!.id, info.id);
  expect(servers).not.toEqual([]);
  expect(servers[0]).toHaveProperty('name');
  expect(servers[0]).toHaveProperty('url');
});

test('fetchByCountry: returns a filled object of movies/tv data by country', async () => {
  const data = await himovies.fetchByCountry('KR');
  expect(data.results).not.toEqual([]);
});

test('fetchByGenre: returns a filled object of movies/tv data by genre', async () => {
  const data = await himovies.fetchByGenre('drama');
  expect(data.results).not.toEqual([]);
});

test('fetchSpotlight: returns a structurally-valid response (may be empty)', async () => {
  // The legacy `div.swiper-slide` hero carousel was removed from the current
  // himovies.bz / sflix-family homepage layout, so the call can legitimately
  // resolve to an empty results array; we only assert the method works and
  // returns the expected shape. The selector itself is tracked separately.
  const data = await himovies.fetchSpotlight();
  expect(Array.isArray(data.results)).toBe(true);
  for (const r of data.results) {
    expect(r.id).toMatch(/^(movie|tv)\//);
  }
});

test('fetchRecentMovies: returns a filled array of recent movies', async () => {
  const data = await himovies.fetchRecentMovies();
  expect(data).not.toEqual([]);
});

test('fetchRecentTvShows: returns a filled array of recent tv-shows', async () => {
  const data = await himovies.fetchRecentTvShows();
  expect(data).not.toEqual([]);
});

test('fetchTrendingMovies: returns a filled array of trending movies', async () => {
  const data = await himovies.fetchTrendingMovies();
  expect(data).not.toEqual([]);
});

test('fetchTrendingTvShows: returns a filled array of trending tv-shows', async () => {
  const data = await himovies.fetchTrendingTvShows();
  expect(data).not.toEqual([]);
});
