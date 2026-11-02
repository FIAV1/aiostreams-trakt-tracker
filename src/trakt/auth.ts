import { TraktConfig, TraktApiConfig } from './config.js';
import { generateCodeVerifier, generateCodeChallenge } from './auth-utils.js';

export interface TraktTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class TraktAuth {
  constructor(private config: TraktConfig) {}

  async getAuthorizationUrl(state: string, codeVerifier: string) {
    const challenge = generateCodeChallenge(codeVerifier);
    const url = new URL(TraktApiConfig.authUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('scope', 'rebind');
    return url.toString();
  }

  async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<TraktTokens> {
    const response = await fetch(TraktApiConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      throw new Error(`Trakt token exchange failed: ${await response.text()}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  async refreshTokens(refreshToken: string): Promise<TraktTokens> {
    const response = await fetch(TraktApiConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Trakt token refresh failed: ${await response.text()}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }
}
