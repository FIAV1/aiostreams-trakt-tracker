import { TraktConfig, TraktApiConfig } from './config.js';

export interface TraktTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface TraktDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export type TraktDevicePollResult =
  | { status: 'pending' | 'slow_down' }
  | { status: 'authorized'; tokens: TraktTokens }
  | { status: 'invalid' | 'already_used' | 'expired' | 'denied' };

export class TraktOAuthError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'TraktOAuthError';
  }
}

export class TraktAuth {
  constructor(private config: TraktConfig) {}

  async requestDeviceCode(): Promise<TraktDeviceCode> {
    const response = await fetch(`${TraktApiConfig.baseUrl}/oauth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.config.clientId }),
    });
    if (!response.ok) throw new TraktOAuthError(`Trakt device code request failed (${response.status})`, response.status);
    const data = await response.json();
    const verificationUrl = new URL(data.verification_url);
    if (verificationUrl.protocol !== 'https:' || !(verificationUrl.hostname === 'trakt.tv' || verificationUrl.hostname.endsWith('.trakt.tv'))) {
      throw new Error('Trakt returned an invalid device verification URL');
    }
    if (typeof data.device_code !== 'string' || !data.device_code
      || typeof data.user_code !== 'string' || !data.user_code
      || !Number.isFinite(data.expires_in) || data.expires_in <= 0
      || !Number.isFinite(data.interval) || data.interval <= 0) {
      throw new Error('Trakt returned an invalid device code response');
    }
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUrl: verificationUrl.toString(),
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  }

  async pollDeviceToken(deviceCode: string): Promise<TraktDevicePollResult> {
    const response = await fetch(`${TraktApiConfig.baseUrl}/oauth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: deviceCode,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });
    if (response.status === 400) return { status: 'pending' };
    if (response.status === 429) return { status: 'slow_down' };
    if (response.status === 404) return { status: 'invalid' };
    if (response.status === 409) return { status: 'already_used' };
    if (response.status === 410) return { status: 'expired' };
    if (response.status === 418) return { status: 'denied' };
    if (!response.ok) throw new TraktOAuthError(`Trakt device authorization failed (${response.status})`, response.status);
    return { status: 'authorized', tokens: this.readTokens(await response.json()) };
  }

  private readTokens(data: any): TraktTokens {
    if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string'
      || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in)) {
      throw new Error('Trakt returned an invalid token response');
    }
    const createdAt = typeof data.created_at === 'number' ? data.created_at * 1000 : Date.now();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: createdAt + data.expires_in * 1000,
    };
  }

  async refreshTokens(refreshToken: string): Promise<TraktTokens> {
    const response = await fetch(TraktApiConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Trakt token refresh failed: ${await response.text()}`);
    }

    return this.readTokens(await response.json());
  }

  async revokeToken(accessToken: string): Promise<void> {
    const response = await fetch(`${TraktApiConfig.baseUrl}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken, client_id: this.config.clientId, client_secret: this.config.clientSecret }),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Trakt token revocation failed (${response.status}): ${await response.text()}`);
    }
  }
}
