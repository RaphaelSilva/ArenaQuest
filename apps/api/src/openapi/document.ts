import type { Context } from 'hono';
import { OpenAPIHono } from '@hono/zod-openapi';
import { ErrorBody, ValidationErrorBody, PaginationQuery } from './components';

/**
 * Statically known deployments. The origin the document is actually served
 * from is prepended at request time by `resolveServers`, so this list only
 * needs to carry the targets a reader cannot discover by browsing.
 */
const KNOWN_SERVERS: ReadonlyArray<{ url: string; description: string }> = [
  { url: 'http://localhost:8787', description: 'Local development' },
  { url: 'https://api-staging.taibudo.com', description: 'Staging environment' },
  { url: 'https://api.arenaquest.app', description: 'Production environment' },
];

/**
 * Builds the `servers` list for one request.
 *
 * The first entry is the origin the request came in on, which is what makes
 * Scalar's "Try it" default to the host the docs are being read from: opening
 * http://192.168.1.104:8787/docs from a phone on the LAN offers
 * http://192.168.1.104:8787 instead of a localhost that only resolves on the
 * developer's own machine. The known deployments follow, de-duplicated so the
 * live origin is never listed twice.
 */
export function resolveServers(requestUrl: string): Array<{ url: string; description: string }> {
  let currentOrigin: string | null = null;
  try {
    currentOrigin = new URL(requestUrl).origin;
  } catch {
    currentOrigin = null;
  }

  const known = KNOWN_SERVERS.map((server) => ({ ...server }));
  if (!currentOrigin) {
    return known;
  }

  const alreadyKnown = known.find((server) => server.url === currentOrigin);
  if (alreadyKnown) {
    // Keep it, but promote it so it is the option Scalar preselects.
    return [alreadyKnown, ...known.filter((server) => server !== alreadyKnown)];
  }

  return [{ url: currentOrigin, description: 'Current host' }, ...known];
}

/**
 * Root OpenAPI document configuration for ArenaQuest API.
 * This document is served at GET /openapi.json.
 *
 * Security schemes placeholder wired for future JWT bearer auth routes.
 */
export function configureOpenAPIDocument(app: OpenAPIHono) {
  app.doc31('/openapi.json', (c: Context) => ({
    openapi: '3.1.0',
    info: {
      title: 'ArenaQuest API',
      version: '1.0.0',
      description: 'API for the ArenaQuest platform',
    },
    servers: resolveServers(c.req.url),
    components: {
      schemas: {
        ErrorBody,
        ValidationErrorBody,
        PaginationQuery,
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT bearer token for authenticated endpoints',
        },
      },
    },
  }));
}
