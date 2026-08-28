import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/site';

/**
 * Only two surfaces on this domain are public: the company homepage and the
 * righthand landing page. Everything else is either an API, a login-gated doctor
 * screen, or a per-patient intake link — none of which may be crawled.
 *
 * `/righthand/patient*` and `/righthand/billing*` are not routes in this app; they
 * are rewrites to separate deployments (see next.config.ts). robots.txt is served
 * per-host, so this file is what governs them on entanglecare.com.
 *
 * `/intake` and `/dashboard*` are permanent redirects to those private paths and
 * are listed so old printed links do not pull a crawler toward them.
 */
const DISALLOW = [
  '/api/',
  '/righthand/doctor/',
  '/righthand/patient',
  '/righthand/billing',
  '/righthand/admin',
  '/intake',
  '/dashboard',
];

/**
 * Named so the answer-engine crawlers are an explicit decision rather than an
 * accident of the wildcard rule. They get the same disallow list: being welcome
 * to the public pages is not permission to reach patient data.
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'CCBot',
  'Applebot-Extended',
  'Bytespider',
  'meta-externalagent',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      { userAgent: AI_CRAWLERS, allow: '/', disallow: DISALLOW },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/').replace(/\/$/, ''),
  };
}
