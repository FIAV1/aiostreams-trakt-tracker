import { z } from 'zod';

export const TraktConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
});

export type TraktConfig = z.infer<typeof TraktConfigSchema>;

export const TraktApiConfig = {
  baseUrl: 'https://api.trakt.tv',
  tokenUrl: 'https://api.trakt.tv/oauth/token',
};
