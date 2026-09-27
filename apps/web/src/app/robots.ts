import type { MetadataRoute } from 'next';
import { PUBLIC_SITE_ORIGIN } from '@web/lib/events-api';

/**
 * `robots.txt`.
 *
 * Everything under `(public)` is meant to be found; everything else in this app
 * is a signed-in surface that a crawler can only ever receive as a redirect to
 * `/login`, so it is disallowed rather than left to waste crawl budget.
 *
 * This is a hint to well-behaved crawlers and **not** an access control. The
 * authorisation that matters is the API's: an audience-scoped event is a `404`
 * to an anonymous caller whether or not a robot was told to stay away.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/events'],
        disallow: ['/admin', '/dashboard', '/catalog', '/tasks', '/settings', '/auth'],
      },
    ],
    sitemap: `${PUBLIC_SITE_ORIGIN}/sitemap.xml`,
  };
}
