import { OpenAPIHono } from '@hono/zod-openapi';
import { ErrorBody, ValidationErrorBody, PaginationQuery } from './components';

/**
 * Root OpenAPI document configuration for ArenaQuest API.
 * This document is served at GET /openapi.json.
 *
 * Servers are currently hardcoded (externalisation planned for F8).
 * Security schemes placeholder wired for future JWT bearer auth routes.
 */
export function configureOpenAPIDocument(app: OpenAPIHono) {
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'ArenaQuest API',
      version: '1.0.0',
      description: 'API for the ArenaQuest platform',
    },
    servers: [
      {
        url: 'http://localhost:8787',
        description: 'Local development',
      },
      {
        url: 'https://api-staging.arenaquest.app',
        description: 'Staging environment',
      },
      {
        url: 'https://api.arenaquest.app',
        description: 'Production environment',
      },
    ],
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
  });
}


