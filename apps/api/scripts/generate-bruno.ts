import * as fs from 'fs';
import * as path from 'path';

// Helper to sanitize folder names from tags
function getFolderNameFromTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Helper to slugify filenames from request names
function getFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') + '.yml';
}

// Helper to convert an object to OpenCollection YAML string representation
function toYAML(val: any, indent = 0): string {
  const padding = ' '.repeat(indent);
  if (val === null) return 'null';
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    // If it has newlines, format as a block literal
    if (val.includes('\n')) {
      const lines = val.split('\n');
      return '|-\n' + lines.map(line => ' '.repeat(indent + 2) + line).join('\n');
    }
    // Escape quote marks if needed, or wrap in quotes if containing special characters
    const specialChars = /[:{}[\]\n,&\*#\?\|\-<>=!%@`"]/;
    if (specialChars.test(val) || val === 'true' || val === 'false' || val === 'null') {
      return JSON.stringify(val);
    }
    return val;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    return '\n' + val.map(item => {
      if (typeof item === 'object' && item !== null) {
        const entries = Object.entries(item);
        if (entries.length === 0) return padding + '- {}';
        const first = entries[0];
        const rest = entries.slice(1);
        let str = `${padding}- ${first[0]}: ${toYAML(first[1], indent + 4)}`;
        for (const [k, v] of rest) {
          str += `\n${padding}  ${k}: ${toYAML(v, indent + 4)}`;
        }
        return str;
      }
      return `${padding}- ${toYAML(item, indent + 2)}`;
    }).join('\n');
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val);
    if (entries.length === 0) return '{}';
    return '\n' + entries.map(([k, v]) => {
      const formattedValue = toYAML(v, indent + 2);
      if (formattedValue.startsWith('\n')) {
        return `${padding}${k}:${formattedValue}`;
      } else {
        return `${padding}${k}: ${formattedValue}`;
      }
    }).join('\n');
  }
  return '';
}

// Generate mock data recursively from OpenAPI schemas
function generateMockFromSchema(schema: any, components: any): any {
  if (!schema) return null;

  if (schema.$ref) {
    const refPath = schema.$ref.replace('#/components/schemas/', '');
    const resolved = components.schemas?.[refPath];
    if (!resolved) return null;
    return generateMockFromSchema(resolved, components);
  }

  if (schema.allOf && Array.isArray(schema.allOf)) {
    let mock = {};
    for (const sub of schema.allOf) {
      const subMock = generateMockFromSchema(sub, components);
      if (typeof subMock === 'object' && subMock !== null) {
        mock = { ...mock, ...subMock };
      }
    }
    return mock;
  }
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    return generateMockFromSchema(schema.anyOf[0], components);
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    return generateMockFromSchema(schema.oneOf[0], components);
  }

  if (schema.type === 'object' || schema.properties) {
    const obj: any = {};
    const props = schema.properties || {};
    for (const [key, prop] of Object.entries(props)) {
      obj[key] = generateMockFromSchema(prop, components);
    }
    return obj;
  }

  if (schema.type === 'array') {
    const items = schema.items;
    return [generateMockFromSchema(items, components)];
  }

  if (schema.example !== undefined) {
    return schema.example;
  }
  if (schema.default !== undefined) {
    return schema.default;
  }

  if (schema.type === 'string') {
    if (schema.format === 'email') return 'student@arenaquest.app';
    if (schema.format === 'date-time') return new Date().toISOString();
    if (schema.format === 'uuid') return 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
    return 'string';
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    return 1;
  }
  if (schema.type === 'boolean') {
    return true;
  }

  if (Array.isArray(schema.type)) {
    const primaryType = schema.type.find((t: string) => t !== 'null');
    if (primaryType) {
      return generateMockFromSchema({ ...schema, type: primaryType }, components);
    }
  }

  return null;
}

function main() {
  const openapiPath = path.resolve(__dirname, '../openapi.json');
  if (!fs.existsSync(openapiPath)) {
    console.error(`Error: openapi.json not found at ${openapiPath}. Please run dump-openapi first.`);
    process.exit(1);
  }

  const openapiDoc = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
  const brunoDir = path.resolve(__dirname, '../bruno/Apps-Api');

  console.log('Cleaning up existing generated Bruno requests...');
  if (fs.existsSync(brunoDir)) {
    const items = fs.readdirSync(brunoDir);
    for (const item of items) {
      if (item === 'opencollection.yml' || item === 'environments') {
        continue;
      }
      const fullPath = path.join(brunoDir, item);
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  } else {
    fs.mkdirSync(brunoDir, { recursive: true });
  }

  const paths = openapiDoc.paths || {};
  const components = openapiDoc.components || {};

  // Track sequence numbers per folder to maintain ordering in Bruno
  const seqCounters: Record<string, number> = {};

  for (const [urlPath, pathItem] of Object.entries(paths)) {
    if (typeof pathItem !== 'object' || pathItem === null) continue;

    const pathParams = (pathItem as any).parameters || [];

    for (const [method, operation] of Object.entries(pathItem as any)) {
      if (method === 'parameters') continue;
      const op = operation as any;

      // Extract tags to form folder name
      const tags = op.tags || [];
      const firstTag = tags[0] || 'general';
      const folderName = getFolderNameFromTag(firstTag);
      const folderPath = path.join(brunoDir, folderName);

      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      // Determine request details
      const summary = op.summary || `${method.toUpperCase()} ${urlPath}`;
      const filename = getFilename(summary);
      const filePath = path.join(folderPath, filename);

      // Increment sequence for this folder
      seqCounters[folderName] = (seqCounters[folderName] || 0) + 1;
      const seq = seqCounters[folderName];

      // Parse Path & Query Parameters
      const operationParams = op.parameters || [];
      const allParams = [...pathParams, ...operationParams];
      const pathParameters = allParams.filter((p: any) => p.in === 'path');
      const queryParameters = allParams.filter((p: any) => p.in === 'query');

      // Convert URL format and extract params lists
      let brunoUrlPath = urlPath;
      const pathParamsList: any[] = [];
      const queryParamsList: any[] = [];

      // Translate path parameters: /v1/topics/{id} -> /v1/topics/:id
      const urlMatches = urlPath.match(/\{([^}]+)\}/g);
      if (urlMatches) {
        for (const match of urlMatches) {
          const name = match.slice(1, -1);
          brunoUrlPath = brunoUrlPath.replace(match, `:${name}`);

          const paramDef = pathParameters.find((p: any) => p.name === name);
          const mockVal = paramDef && paramDef.schema ? generateMockFromSchema(paramDef.schema, components) : '';
          pathParamsList.push({
            name,
            value: mockVal !== null ? String(mockVal) : '',
            type: 'path'
          });
        }
      }

      // Populate query parameters
      for (const qParam of queryParameters) {
        const mockVal = qParam.schema ? generateMockFromSchema(qParam.schema, components) : '';
        queryParamsList.push({
          name: qParam.name,
          value: mockVal !== null ? String(mockVal) : '',
          type: 'query'
        });
      }

      const params = [...pathParamsList, ...queryParamsList];

      // Generate Request Body
      let bodyType: string | undefined;
      let bodyData: string | undefined;

      const requestBody = op.requestBody;
      if (requestBody && requestBody.content && requestBody.content['application/json']) {
        const schema = requestBody.content['application/json'].schema;
        const mockBody = generateMockFromSchema(schema, components);
        if (mockBody) {
          bodyType = 'json';
          bodyData = JSON.stringify(mockBody, null, 2);
        }
      }

      // Build Headers
      const headers = [];
      if (bodyType === 'json') {
        headers.push({ name: 'content-type', value: 'application/json' });
      }

      // Construct Bruno Collection Request structure
      const brunoRequest: any = {
        info: {
          name: summary,
          type: 'http',
          seq
        },
        http: {
          method: method.toUpperCase(),
          url: `{{host}}${brunoUrlPath}`
        }
      };

      if (headers.length > 0) {
        brunoRequest.http.headers = headers;
      }

      if (params.length > 0) {
        brunoRequest.http.params = params;
      }

      if (bodyType && bodyData) {
        brunoRequest.http.body = {
          type: bodyType,
          data: bodyData
        };
      }

      brunoRequest.http.auth = 'inherit';

      brunoRequest.settings = {
        encodeUrl: true,
        timeout: 0,
        followRedirects: true,
        maxRedirects: 5
      };

      // Write to request file as OpenCollection YAML
      const yamlContent = toYAML(brunoRequest).trim() + '\n';
      fs.writeFileSync(filePath, yamlContent, 'utf8');
      console.log(`Generated request: ${folderName}/${filename}`);
    }
  }

  console.log('Successfully generated all Bruno request files.');
}

main();
