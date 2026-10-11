import { readFileSync } from 'node:fs';
import type { FastifySchema } from 'fastify';
import { parse } from 'yaml';

export type JsonObject = Record<string, unknown>;
export const contractUrl = new URL('../../../../contracts/openapi.yaml', import.meta.url);

function asObject(value: unknown, context: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid OpenAPI object: ${context}`);
  }
  return value as JsonObject;
}

export function loadContract(): JsonObject {
  return asObject(parse(readFileSync(contractUrl, 'utf8'), { maxAliasCount: 50 }), 'document');
}

/** Resolve local references only. Contract loading must never perform network requests. */
export function resolveSchema(document: JsonObject, value: unknown, ancestors: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveSchema(document, entry, ancestors));
  }
  if (value === null || typeof value !== 'object') return value;

  const object = value as JsonObject;
  if (typeof object.$ref === 'string') {
    const reference = object.$ref;
    if (!reference.startsWith('#/')) {
      throw new Error('Only local OpenAPI references are supported');
    }
    if (ancestors.includes(reference)) {
      throw new Error(`Circular OpenAPI reference: ${reference}`);
    }
    let target: unknown = document;
    for (const segment of reference.slice(2).split('/')) {
      const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
      target = asObject(target, reference)[key];
    }
    const { $ref: _reference, ...siblings } = object;
    return {
      ...asObject(resolveSchema(document, target, [...ancestors, reference]), reference),
      ...asObject(resolveSchema(document, siblings, ancestors), reference),
    };
  }

  return Object.fromEntries(Object.entries(object).map(([key, child]) => [
    key,
    resolveSchema(document, child, ancestors),
  ]));
}

export function operationSchema(document: JsonObject, path: string): FastifySchema {
  const paths = asObject(document.paths, 'paths');
  const item = asObject(paths[path], path);
  const operation = asObject(item.get, `GET ${path}`);
  const schema: FastifySchema = {};
  const allParameters = [...(Array.isArray(item.parameters) ? item.parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : [])];

  for (const [location, schemaKey] of [['query', 'querystring'], ['path', 'params']] as const) {
    const properties: JsonObject = {};
    const required: string[] = [];
    for (const unresolved of allParameters) {
      const parameter = asObject(resolveSchema(document, unresolved), 'parameter');
      if (parameter.in !== location || typeof parameter.name !== 'string') continue;
      properties[parameter.name] = resolveSchema(document, parameter.schema);
      if (parameter.required === true) required.push(parameter.name);
    }
    if (location === 'query' || Object.keys(properties).length > 0) {
      schema[schemaKey] = {
        type: 'object',
        properties,
        additionalProperties: false,
        ...(required.length > 0 ? { required } : {}),
      };
    }
  }

  const responses = asObject(operation.responses, 'responses');
  const responseSchemas: JsonObject = {};
  for (const [status, unresolved] of Object.entries(responses)) {
    const response = asObject(resolveSchema(document, unresolved), 'response');
    if (response.content === undefined) continue;
    const content = asObject(response.content, 'response content');
    const json = content['application/json'];
    if (json !== undefined) {
      responseSchemas[status] = resolveSchema(document, asObject(json, 'JSON response').schema);
    }
  }
  schema.response = responseSchemas;
  return schema;
}

export function componentSchema(document: JsonObject, name: string): JsonObject {
  return asObject(resolveSchema(document, { $ref: `#/components/schemas/${name}` }), name);
}
