import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import openapiTS, { astToString, COMMENT_HEADER, type OpenAPI3 } from 'openapi-typescript';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as addFormatsImport } from 'ajv-formats';
import { contractUrl, loadContract, resolveSchema, type JsonObject } from '../src/infrastructure/openapi/contract.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => Ajv2020;

function object(value: unknown): JsonObject {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid contract object');
  return value as JsonObject;
}

async function checkContract(): Promise<void> {
  const document = loadContract();
  // Reject non-local refs before either third-party tool sees them. Never fetch remote schemas.
  resolveSchema(document, document);
  await SwaggerParser.validate(fileURLToPath(contractUrl), { resolve: { external: false, http: false } });
  assert.equal(document.openapi, '3.1.0');
  const version = object(document.info).version;
  assert.equal(typeof version, 'string', 'Missing contract version');

  // Generate once, in memory, from this same contract/version and tool invocation for both clients.
  const generated = COMMENT_HEADER + astToString(await openapiTS(document as unknown as OpenAPI3));
  for (const [url, instruction] of [
    [new URL('../src/infrastructure/openapi/generated.ts', import.meta.url), 'pnpm --filter @guardian/api contracts:generate'],
    [new URL('../../web/src/lib/api/schema.d.ts', import.meta.url), 'pnpm --filter @guardian/web api:generate'],
  ] as const) {
    const committed = await readFile(url, 'utf8');
    assert.equal(committed.replaceAll('\r\n', '\n') === generated.replaceAll('\r\n', '\n'), true,
      `Generated types are stale; run ${instruction}`);
  }

  const operations = [];
  const ids = new Set<string>();
  for (const [path, rawItem] of Object.entries(object(document.paths))) {
    const item = object(resolveSchema(document, rawItem));
    for (const method of methods) {
      if (item[method] === undefined) continue;
      const operation = object(item[method]);
      assert.equal(typeof operation.operationId, 'string', 'Missing operationId');
      const id = operation.operationId as string;
      assert.match(id, /^[A-Za-z][A-Za-z0-9_]*$/, 'Unsafe operationId');
      assert.ok(!ids.has(id), 'Duplicate operationId');
      ids.add(id);
      operations.push({ path, method, item, operation, id, examples: 0, statuses: new Set<string>(), routeResponses: 0 });
    }
  }
  assert.ok(operations.length > 0, 'Zero contract operations');
  // No coercion, defaults or additional-field stripping in response validation.
  const validator = addFormats(new Ajv2020({ strict: false, coerceTypes: false, useDefaults: false, removeAdditional: false }));
  let checkedExamples = 0;
  for (const coverage of operations) {
    for (const [status, rawResponse] of Object.entries(object(coverage.operation.responses))) {
      const response = object(resolveSchema(document, rawResponse));
      const json = (response.content as JsonObject | undefined)?.['application/json'];
      assert.ok(json, `${coverage.id} ${status}: JSON response schema/example coverage missing`);
      const media = object(json);
      const validate = validator.compile(object(resolveSchema(document, media.schema)));
      let examples = 0;
      const checkExample = (value: unknown) => {
        assert.equal(validate(value), true, `${coverage.id} ${status}: invalid canonical example`);
        examples += 1;
      };
      if (media.example !== undefined) checkExample(media.example);
      for (const rawExample of Object.values(object(media.examples ?? {}))) {
        const example = object(resolveSchema(document, rawExample));
        assert.ok(Object.hasOwn(example, 'value'), `${coverage.id} ${status}: missing local example value`);
        checkExample(example.value);
      }
      assert.ok(examples > 0, `${coverage.id} ${status}: zero canonical examples`);
      coverage.statuses.add(status);
      coverage.examples += examples;
      checkedExamples += examples;
    }
    assert.ok(coverage.statuses.size > 0, `${coverage.id}: zero response statuses`);
  }

  // Explicit synthetic adapter and isolated configuration: never inherit DATABASE_URL or process env.
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', DATA_ADAPTER: 'mock' }), logger: false });
  try {
    for (const coverage of operations) {
      // Current public-read contract is GET-only. A new method cannot silently evade route coverage.
      assert.equal(coverage.method, 'get', `${coverage.id}: route coverage for method is not implemented`);
      let actualPath = coverage.path;
      const allParameters = [
        ...(Array.isArray(coverage.item.parameters) ? coverage.item.parameters : []),
        ...(Array.isArray(coverage.operation.parameters) ? coverage.operation.parameters : []),
      ];
      for (const rawParameter of allParameters) {
        const parameter = object(resolveSchema(document, rawParameter));
        if (parameter.in !== 'path') continue;
        const schema = object(parameter.schema);
        const examples = Array.isArray(schema.examples) ? schema.examples : [];
        const value = parameter.example ?? schema.example ?? examples[0];
        assert.equal(typeof value, 'string', `${coverage.id}: missing synthetic path parameter example`);
        assert.equal(typeof parameter.name, 'string', `${coverage.id}: invalid parameter name`);
        actualPath = actualPath.replaceAll(`{${parameter.name as string}}`, encodeURIComponent(value as string));
      }
      assert.ok(!/[{}]/.test(actualPath), `${coverage.id}: unresolved path parameter`);
      const result = await app.inject({ method: 'GET', url: actualPath });
      assert.equal(result.statusCode, 200, `${coverage.id}: route is missing or failed`);
      const response = object(resolveSchema(document, object(coverage.operation.responses)[String(result.statusCode)]));
      const media = object(object(response.content)['application/json']);
      const validate = validator.compile(object(resolveSchema(document, media.schema)));
      assert.equal(validate(result.json()), true, `${coverage.id}: route response violates shared contract`);
      assert.match(result.headers['content-type'] ?? '', /^application\/json\b/, `${coverage.id}: invalid response content type`);
      coverage.routeResponses += 1;
    }
  } finally {
    await app.close();
  }
  for (const coverage of operations) {
    process.stdout.write(`${coverage.id}: ${coverage.statuses.size} example statuses, ${coverage.examples} canonical examples, ${coverage.routeResponses} injected success response\n`);
  }
  process.stdout.write(`OpenAPI 3.1 contract ${version as string} valid; frontend/backend generated types match; ${checkedExamples} canonical examples and ${operations.length} operations validated. Error route/header/semantic coverage remains in the dedicated API tests.\n`);
}

try {
  await checkContract();
} catch (error) {
  // Third-party failures can contain schema values/absolute paths. Never print their raw messages.
  const safe = error instanceof assert.AssertionError && typeof error.message === 'string'
    ? error.message : 'Contract validation failed (details suppressed)';
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
}
