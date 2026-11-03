import { z } from 'zod';

export const TraktConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  redirectUri: z.string(),
  publicBaseUrl: z.string(),
});

export type TraktConfig = z.infer<typeof TraktConfigSchema>;

export const TraktApiConfig = {
  baseUrl: 'https://api.trakt.tv',
  authUrl: 'https://auth.trakt.tv/oauth/authorize',
  tokenUrl: 'https://api.trakt.tv/oauth/token',
};
