import { buildApp } from '../src/index';
import * as fs from 'fs';
import * as path from 'path';

// Stub Env object to satisfy buildContainer and buildApp boot
const stubEnv = {
  JWT_SECRET: 'test-secret-at-least-32-chars-long-for-hmac-validation',
  COOKIE_SAMESITE: 'Lax',
  ALLOWED_ORIGINS: '*',
  R2: {} as any,
  R2_S3_ENDPOINT: 'https://stub-s3-endpoint.com',
  R2_ACCESS_KEY_ID: 'stub-access-key-id',
  R2_SECRET_ACCESS_KEY: 'stub-secret-access-key',
  R2_BUCKET_NAME: 'stub-bucket-name',
  RATE_LIMIT_KV: {
    get: () => Promise.resolve(null),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  },
  DB: {
    prepare: () => ({ bind: () => {} }),
    batch: () => Promise.resolve(),
    exec: () => Promise.resolve(),
  },
} as any;

async function main() {
  const app = buildApp(stubEnv);
  const res = await app.request('http://localhost/openapi.json');
  
  if (!res.ok) {
    console.error(`Failed to fetch /openapi.json. Status: ${res.status}`);
    process.exit(1);
  }

  const openapiDoc = await res.json();

  // Sort keys recursively to ensure deterministic output (zero diff on rebuilds)
  function sortKeys(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(sortKeys);
    }
    return Object.keys(obj)
      .sort()
      .reduce((result: any, key: string) => {
        result[key] = sortKeys(obj[key]);
        return result;
      }, {});
  }

  const sortedDoc = sortKeys(openapiDoc);
  const jsonOutput = JSON.stringify(sortedDoc, null, 2);

  const outputPath = path.resolve(__dirname, '../openapi.json');
  fs.writeFileSync(outputPath, jsonOutput, 'utf8');
  console.log(`OpenAPI document successfully dumped to: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
