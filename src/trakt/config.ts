import { z } from 'zod';

export const TraktConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  redirectUri: z.string(),
  publicBaseUrl: z.string(),
});

export type TraktConfig = z.infer<typeof TraktConfigSchema>;

export const TraktApiConfig = {
  baseUrl: 'https://api.trakt.tv',
  authUrl: 'https://trakt.tv/oauth/authorize',
  tokenUrl: 'https://trakt.tv/oauth/token',
};
