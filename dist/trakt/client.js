import { TraktApiConfig } from './config.js';
export class TraktClient {
    config;
    tokens;
    constructor(config, tokens) {
        this.config = config;
        this.tokens = tokens;
    }
    async request(endpoint, options = {}) {
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
    async getSyncHistory(params = {}) {
        return this.fetchAllPages('/sync/history', params);
    }
    async getPlaybackProgress(params = {}) {
        return this.fetchAllPages('/sync/playback', params);
    }
    async getWatchlist(params = {}) {
        return this.fetchAllPages('/sync/watchlist', params);
    }
    async getRatings(params = {}) {
        return this.fetchAllPages('/sync/ratings', params);
    }
    async getActivities(params = {}) {
        return this.fetchAllPages('/sync/activities', params);
    }
    async fetchAllPages(endpoint, params = {}) {
        let allItems = [];
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
            }
            else {
                hasMore = false;
            }
        }
        return { items: allItems };
    }
    async scrobble(videoId, progress, duration) {
        return this.request('/scrobble', {
            method: 'POST',
            body: JSON.stringify({
                videoId,
                progress,
                duration,
            }),
        });
    }
    async markWatched(videoId, type, season, episode) {
        const body = { watched: true };
        if (type === 'episode' && season && episode) {
            body.season = season;
            body.episode = episode;
        }
        return this.request(`/sync/history/${type}s/${videoId}`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }
    async markUnwatched(videoId, type, season, episode) {
        const body = { watched: false };
        if (type === 'episode' && season && episode) {
            body.season = season;
            body.episode = episode;
        }
        return this.request(`/sync/history/${type}s/${videoId}`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }
    async updateWatchlist(videoId, type, action) {
        const method = action === 'add' ? 'POST' : 'DELETE';
        return this.request(`/sync/watchlist/${type}s/${videoId}`, { method });
    }
    async updateRating(videoId, type, rating, season, episode) {
        const method = rating !== null ? 'POST' : 'DELETE';
        const body = rating !== null ? { rating } : undefined;
        if (type === 'season' && season) {
            body.season = season;
        }
        else if (type === 'episode' && season && episode) {
            body.season = season;
            body.episode = episode;
        }
        return this.request(`/sync/ratings/${type}s/${videoId}`, {
            method,
            body: body ? JSON.stringify(body) : undefined,
        });
    }
}
