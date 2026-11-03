import type { TraktConfig } from './config.js';
import { TraktApiConfig } from './config.js';
import { TraktAuth, type TraktTokens } from './auth.js';

export type TraktMediaKind = 'movie' | 'show' | 'season' | 'episode';
export interface TraktMediaRef {
  kind: TraktMediaKind;
  ids: Record<string, string | number>;
  season?: number;
  episode?: number;
}

function idsForApi(ids: Record<string, unknown>): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const key of ['trakt', 'slug', 'imdb', 'tmdb', 'tvdb']) {
    const value = ids[key];
    if ((typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value))) {
      result[key] = value as string | number;
    }
  }
  return result;
}

export class TraktClient {
  private static readonly writeLocks = new Map<string, Promise<void>>();
  private static readonly lastWriteAt = new Map<string, number>();
  private static readonly tokenRefreshes = new Map<string, Promise<TraktTokens>>();

  constructor(
    private readonly config: TraktConfig,
    private tokens: TraktTokens,
    private readonly auth: TraktAuth,
    private readonly onTokensUpdated?: (tokens: TraktTokens) => Promise<void>,
    private readonly rateLimitKey = config.clientId,
  ) {}

  private async paceWrite() {
    const previous = TraktClient.writeLocks.get(this.rateLimitKey) || Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    TraktClient.writeLocks.set(this.rateLimitKey, previous.then(() => turn));
    await previous;
    try {
      const waitMs = Math.max(0, 1000 - (Date.now() - (TraktClient.lastWriteAt.get(this.rateLimitKey) || 0)));
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      TraktClient.lastWriteAt.set(this.rateLimitKey, Date.now());
    } finally { release(); }
  }

  private async refreshIfNeeded() {
    if (!this.tokens.refreshToken) throw new Error('Trakt account is not connected');
    if (this.tokens.expiresAt > Date.now() + 60_000) return;
    let refresh = TraktClient.tokenRefreshes.get(this.rateLimitKey);
    if (!refresh) {
      refresh = (async () => {
        const tokens = await this.auth.refreshTokens(this.tokens.refreshToken);
        await this.onTokensUpdated?.(tokens);
        return tokens;
      })();
      TraktClient.tokenRefreshes.set(this.rateLimitKey, refresh);
    }
    try {
      this.tokens = await refresh;
    } finally {
      if (TraktClient.tokenRefreshes.get(this.rateLimitKey) === refresh) TraktClient.tokenRefreshes.delete(this.rateLimitKey);
    }
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    await this.refreshIfNeeded();
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${this.tokens.accessToken}`);
    headers.set('trakt-api-version', '2');
    headers.set('trakt-api-key', this.config.clientId);

    for (let attempt = 0; ; attempt++) {
      if (['POST', 'PUT', 'DELETE'].includes((options.method || 'GET').toUpperCase())) await this.paceWrite();
      const response = await fetch(`${TraktApiConfig.baseUrl}${endpoint}`, { ...options, headers });
      if (response.status === 429 && attempt < 3) {
        const retryValue = response.headers.get('Retry-After');
        const retryAfter = Number(retryValue);
        const retryAt = retryValue ? Date.parse(retryValue) : NaN;
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Number.isFinite(retryAt) && retryAt > Date.now() ? retryAt - Date.now() : 500 * (2 ** attempt);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      if (response.status === 401) throw new Error('Trakt rejected the access token; reconnect the account');
      if (response.status === 429) throw new Error(`Trakt rate limit exceeded (Retry-After: ${response.headers.get('Retry-After') || 'unknown'} seconds)`);
      if (!response.ok) {
        const body = await response.text();
        let message = body;
        try {
          const json = JSON.parse(body);
          message = json.error_description || json.error || body;
        } catch { /* Preserve non-JSON response text. */ }
        throw new Error(`Trakt API ${response.status}: ${message || response.statusText}`);
      }
      if (response.status === 204) return undefined;
      const contentType = response.headers.get('content-type') || '';
      return contentType.includes('application/json') ? response.json() : undefined;
    }
  }

  getUserSettings() { return this.request('/users/settings'); }

  private async fetchAllPages(endpoint: string, params: Record<string, string> = {}): Promise<any[]> {
    const result: any[] = [];
    const seen = new Set<string>();
    const limit = 100;
    for (let page = 1; page <= 1000; page++) {
      const query = new URLSearchParams({ ...params, page: String(page), limit: String(limit) });
      const data = await this.request(`${endpoint}?${query}`);
      const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      let newItems = 0;
      for (const item of items) {
        const signature = JSON.stringify(item);
        if (seen.has(signature)) continue;
        seen.add(signature);
        result.push(item);
        newItems++;
      }
      if (items.length < limit || !newItems) return result;
    }
    throw new Error(`Trakt pagination exceeded 1000 pages for ${endpoint}`);
  }

  async getSyncHistory() { return { items: await this.fetchAllPages('/sync/history') }; }
  async getPlaybackProgress() { return { items: await this.fetchAllPages('/sync/playback') }; }
  async getWatchlist() { return { items: await this.fetchAllPages('/sync/watchlist') }; }
  async getRatings() { return { items: await this.fetchAllPages('/sync/ratings') }; }
  async getActivities() { return this.request('/sync/last_activities'); }

  private historyPayload(ref: TraktMediaRef, at?: Date) {
    const ids = idsForApi(ref.ids);
    if (!Object.keys(ids).length) throw new Error('No Trakt, IMDb, TMDB, or TVDB identifier is available for this item');
    const watched_at = at?.toISOString();
    if (ref.kind === 'movie') return { movies: [{ ids, ...(watched_at ? { watched_at } : {}) }] };
    if (ref.kind === 'show') return { shows: [{ ids, ...(watched_at ? { watched_at } : {}) }] };
    if (ref.season == null) throw new Error('An episode or season action requires a season number');
    const episodes = ref.kind === 'episode'
      ? ref.episode == null ? [] : [{ number: ref.episode, ...(watched_at ? { watched_at } : {}) }]
      : undefined;
    if (ref.kind === 'episode' && !episodes?.length) throw new Error('An episode action requires an episode number');
    return { shows: [{ ids, seasons: [{ number: ref.season, ...(episodes ? { episodes } : {}), ...(watched_at && !episodes ? { watched_at } : {}) }] }] };
  }

  async scrobble(action: 'start' | 'pause' | 'stop', ref: TraktMediaRef, progress: number) {
    const ids = idsForApi(ref.ids);
    if (!Object.keys(ids).length) throw new Error('No supported identifier is available for scrobbling');
    const media = ref.kind === 'movie'
      ? { movie: { ids } }
      : { show: { ids }, episode: { season: ref.season, number: ref.episode } };
    return this.request(`/scrobble/${action}`, { method: 'POST', body: JSON.stringify({ ...media, progress }) });
  }

  async markWatched(ref: TraktMediaRef, at?: Date) {
    return this.request('/sync/history', { method: 'POST', body: JSON.stringify(this.historyPayload(ref, at)) });
  }

  async markWatchedBulk(ids: Record<string, unknown>, episodes: Array<{ season: number; episode: number }>, at: Date, watched: boolean) {
    const traktIds = idsForApi(ids);
    if (!Object.keys(traktIds).length) throw new Error('No supported identifier is available for the bulk history action');
    const seasons = new Map<number, Array<{ number: number; watched_at?: string }>>();
    for (const item of episodes) {
      const list = seasons.get(item.season) || [];
      list.push({ number: item.episode, ...(watched ? { watched_at: at.toISOString() } : {}) });
      seasons.set(item.season, list);
    }
    const payload = { shows: [{
      ids: traktIds,
      seasons: [...seasons.entries()].map(([number, seasonEpisodes]) => ({ number, episodes: seasonEpisodes })),
    }] };
    return this.request(watched ? '/sync/history' : '/sync/history/remove', {
      method: 'POST', body: JSON.stringify(payload),
    });
  }

  async markUnwatched(ref: TraktMediaRef) {
    return this.request('/sync/history/remove', { method: 'POST', body: JSON.stringify(this.historyPayload(ref)) });
  }

  async updateWatchlist(ref: TraktMediaRef, action: 'add' | 'remove') {
    const ids = idsForApi(ref.ids);
    if (!Object.keys(ids).length) throw new Error('No supported identifier is available for the watchlist action');
    if (ref.kind !== 'movie' && ref.kind !== 'show') throw new Error('Trakt watchlist accepts movies and shows for this addon');
    const body = { [ref.kind === 'movie' ? 'movies' : 'shows']: [{ ids }] };
    return this.request(action === 'add' ? '/sync/watchlist' : '/sync/watchlist/remove', { method: 'POST', body: JSON.stringify(body) });
  }

  async updateRating(ref: TraktMediaRef, rating: number | null, at?: Date) {
    const ids = idsForApi(ref.ids);
    if (!Object.keys(ids).length) throw new Error('No supported identifier is available for the rating action');
    if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 10)) {
      throw new Error('AIOStreams ratings must be a finite number from 0 to 10');
    }
    const traktRating = rating === null ? null : Math.round(rating);
    const body = traktRating === null || traktRating === 0
      ? this.historyPayload(ref)
      : this.ratingPayload(ref, traktRating, at);
    return this.request(traktRating === null || traktRating === 0 ? '/sync/ratings/remove' : '/sync/ratings', {
      method: 'POST', body: JSON.stringify(body),
    });
  }

  private ratingPayload(ref: TraktMediaRef, rating: number, at?: Date) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) throw new Error('Trakt ratings must be whole numbers from 1 to 10');
    const ids = idsForApi(ref.ids);
    const rated_at = at?.toISOString();
    const extra = { rating, ...(rated_at ? { rated_at } : {}) };
    if (ref.kind === 'movie') return { movies: [{ ids, ...extra }] };
    if (ref.kind === 'show') return { shows: [{ ids, ...extra }] };
    if (ref.season == null) throw new Error('A season or episode rating requires a season number');
    const episode = ref.kind === 'episode'
      ? ref.episode == null ? null : { number: ref.episode, ...extra }
      : undefined;
    if (episode === null) throw new Error('An episode rating requires an episode number');
    return { shows: [{ ids, seasons: [{ number: ref.season, ...(episode ? { episodes: [episode] } : extra) }] }] };
  }
}
