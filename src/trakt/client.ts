import { TraktConfig, TraktApiConfig } from './config.js';
import { TraktTokens } from './auth.js';

export class TraktClient {
  constructor(private config: TraktConfig, private tokens: TraktTokens) {}

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${TraktApiConfig.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.tokens.accessToken}`,
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      throw new Error('Unauthorized: Token may be expired');
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new Error(`Rate limited: Retry after ${retryAfter || 'unknown'} seconds`);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || `Trakt API error: ${response.status} ${await response.text()}`;
      throw new Error(errorMessage);
    }

    return response.json();
  }

  async getSyncHistory(params: { limit?: number, offset?: number } = {}) {
    return this.fetchAllPages('/sync/history', params);
  }

  async getPlaybackProgress(params: { limit?: number, offset?: number } = {}) {
    return this.fetchAllPages('/sync/playback', params);
  }

  async getWatchlist(params: { limit?: number, offset?: number } = {}) {
    return this.fetchAllPages('/sync/watchlist', params);
  }

  async getRatings(params: { limit?: number, offset?: number } = {}) {
    return this.fetchAllPages('/sync/ratings', params);
  }

  async getActivities(params: { limit?: number, offset?: number } = {}) {
    return this.fetchAllPages('/sync/activities', params);
  }

  private async fetchAllPages(endpoint: string, params: { limit?: number, offset?: number } = {}): Promise<any> {
    let allItems: any[] = [];
    let offset = params.offset || 0;
    const limit = params.limit || 100;
    let hasMore = true;

    while (hasMore) {
      const query = new URLSearchParams();
      query.append('limit', limit.toString());
      query.append('offset', offset.toString());
      
      const data = await this.request(`${endpoint}?${query.toString()}`);
      
      if (data.items && Array.isArray(data.items)) {
        allItems.push(...data.items);
        offset += data.items.length;
        hasMore = data.items.length === limit;
      } else {
        hasMore = false;
      }
    }

    return { items: allItems };
  }
  }

  async scrobble(videoId: string, progress: number, duration: number) {
    return this.request('/scrobble', {
      method: 'POST',
      body: JSON.stringify({
        videoId,
        progress,
        duration,
      }),
    });
  }

  async markWatched(videoId: string, type: 'movie' | 'episode', season?: number, episode?: number) {
    const body: any = { watched: true };
    if (type === 'episode' && season && episode) {
      body.season = season;
      body.episode = episode;
    }
    return this.request(`/sync/history/${type}s/${videoId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async markUnwatched(videoId: string, type: 'movie' | 'episode', season?: number, episode?: number) {
    const body: any = { watched: false };
    if (type === 'episode' && season && episode) {
      body.season = season;
      body.episode = episode;
    }
    return this.request(`/sync/history/${type}s/${videoId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateWatchlist(videoId: string, type: 'movie' | 'show', action: 'add' | 'remove') {
    const method = action === 'add' ? 'POST' : 'DELETE';
    return this.request(`/sync/watchlist/${type}s/${videoId}`, { method });
  }

  async updateRating(videoId: string, type: 'movie' | 'show' | 'season' | 'episode', rating: number | null, season?: number, episode?: number) {
    const method = rating !== null ? 'POST' : 'DELETE';
    const body: any = rating !== null ? { rating } : undefined;
    if (type === 'season' && season) {
      body.season = season;
    } else if (type === 'episode' && season && episode) {
      body.season = season;
      body.episode = episode;
    }
    return this.request(`/sync/ratings/${type}s/${videoId}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}
