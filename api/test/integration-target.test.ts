import assert from 'node:assert/strict';
import test from 'node:test';
import { validateIntegrationTargets } from './support/integration-target.js';

// All values are synthetic; this suite never reads process.env or constructs a Pool.
const run = '0123456789abcdef0123456789abcdef';
const otherRun = 'fedcba9876543210fedcba9876543210';
const database = `guardian_test_${run}_w0`;
const credentials = 'fictional:SYNTHETIC_PASSWORD';
const url = `postgresql://${credentials}@127.0.0.1:5432/${database}`;
const readonlyUrl = `postgresql://fictional_readonly:SYNTHETIC_PASSWORD@127.0.0.1:5432/${database}`;
const valid: Record<string, string | undefined> = {
  NODE_ENV: 'test', GUARDIAN_TEST_RUN_ID: run, GUARDIAN_TEST_WORKER_ID: '0',
  GUARDIAN_TEST_TARGET_APPROVAL: `synthetic-disposable:${run}`,
  GUARDIAN_TEST_DATABASE_URL: url, GUARDIAN_TEST_READONLY_DATABASE_URL: readonlyUrl,
};

const allowedTargets: [string, Record<string, string | undefined>][] = [
  ['explicit IPv4 run/worker target shared by maintenance and readonly suites', valid],
  ['explicit IPv6 literal and postgres scheme', { ...valid,
    GUARDIAN_TEST_DATABASE_URL: url.replace('postgresql:', 'postgres:').replace('127.0.0.1', '[::1]'),
    GUARDIAN_TEST_READONLY_DATABASE_URL: readonlyUrl.replace('127.0.0.1', '[::1]'),
  }],
  ['different worker in the same disposable run', { ...valid, GUARDIAN_TEST_WORKER_ID: '12',
    GUARDIAN_TEST_DATABASE_URL: url.replace('_w0', '_w12'), GUARDIAN_TEST_READONLY_DATABASE_URL: readonlyUrl.replace('_w0', '_w12'),
  }],
  ['ordinary business URLs ignored rather than used as fallback', { ...valid,
    DATABASE_URL: 'SYNTHETIC_BUSINESS_URL', TEST_DATABASE_URL: 'SYNTHETIC_LEGACY_URL',
  }],
];
for (const [name, values] of allowedTargets) {
  test(`integration target allows ${name} without I/O`, () => {
    assert.deepEqual(validateIntegrationTargets(values), {
      maintenanceUrl: values.GUARDIAN_TEST_DATABASE_URL, readonlyUrl: values.GUARDIAN_TEST_READONLY_DATABASE_URL,
    });
  });
}

function refuses(values: Record<string, string | undefined>): void {
  assert.throws(() => validateIntegrationTargets(values), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /^UNEXECUTED:/);
    assert.doesNotMatch(error.message, /postgres(?:ql)?:\/\/|SYNTHETIC_PASSWORD|fictional|127\.0\.0\.1|example\.invalid/);
    assert.ok(!error.message.includes(run));
    return true;
  });
}

const invalidSettings: [string, Record<string, string | undefined>][] = [
  ['missing NODE_ENV', { NODE_ENV: undefined }], ['production NODE_ENV', { NODE_ENV: 'production' }],
  ['development NODE_ENV', { NODE_ENV: 'development' }], ['unknown NODE_ENV', { NODE_ENV: 'Test' }],
  ['missing approval', { GUARDIAN_TEST_TARGET_APPROVAL: undefined }],
  ['generic approval not bound to this run', { GUARDIAN_TEST_TARGET_APPROVAL: 'true' }],
  ['shared staging approval', { GUARDIAN_TEST_TARGET_APPROVAL: `shared-staging:${run}` }],
  ['stale approval for another run', { GUARDIAN_TEST_TARGET_APPROVAL: `synthetic-disposable:${otherRun}` }],
  ['missing run ID', { GUARDIAN_TEST_RUN_ID: undefined }], ['reusable test run name', { GUARDIAN_TEST_RUN_ID: 'test' }],
  ['malformed run ID', { GUARDIAN_TEST_RUN_ID: `${run}/..` }],
  ['missing worker ID', { GUARDIAN_TEST_WORKER_ID: undefined }],
  ['non-canonical worker ID', { GUARDIAN_TEST_WORKER_ID: '01' }],
  ['out-of-range worker ID', { GUARDIAN_TEST_WORKER_ID: '10000' }],
  ['missing maintenance URL despite DATABASE_URL', { GUARDIAN_TEST_DATABASE_URL: undefined, DATABASE_URL: url }],
  ['missing maintenance URL despite TEST_DATABASE_URL', { GUARDIAN_TEST_DATABASE_URL: undefined, TEST_DATABASE_URL: url }],
  ['missing readonly URL', { GUARDIAN_TEST_READONLY_DATABASE_URL: undefined }],
  ['readonly different run', { GUARDIAN_TEST_READONLY_DATABASE_URL: readonlyUrl.replace(run, otherRun) }],
  ['readonly different worker', { GUARDIAN_TEST_READONLY_DATABASE_URL: readonlyUrl.replace('_w0', '_w1') }],
  ['readonly different port', { GUARDIAN_TEST_READONLY_DATABASE_URL: readonlyUrl.replace(':5432', ':5433') }],
  ['readonly different loopback server', { GUARDIAN_TEST_READONLY_DATABASE_URL: readonlyUrl.replace('127.0.0.1', '[::1]') }],
];
for (const [name, changes] of invalidSettings) {
  test(`integration target rejects ${name} before any connection`, () => refuses({ ...valid, ...changes }));
}

const invalidUrls: [string, string | undefined][] = [
  ['missing URL', undefined], ['empty URL', ''], ['malformed URL', 'SYNTHETIC_PASSWORD'],
  ['wrong scheme', url.replace('postgresql:', 'https:')],
  ['remote/shared staging domain even with correct test name', url.replace('127.0.0.1', 'staging.example.invalid')],
  ['non-loopback IP', url.replace('127.0.0.1', '192.0.2.1')],
  ['private network IP', url.replace('127.0.0.1', '10.0.0.1')],
  ['DNS localhost rather than literal loopback', url.replace('127.0.0.1', 'localhost')],
  ['trailing-dot host', url.replace('127.0.0.1', '127.0.0.1.')],
  ['missing explicit port', url.replace(':5432', '')], ['zero port', url.replace(':5432', ':0')],
  ['out-of-range port', url.replace(':5432', ':65536')],
  ['missing explicit user and password', url.replace(`${credentials}@`, '')],
  ['missing explicit user', url.replace('fictional:', ':')],
  ['missing explicit password', url.replace(':SYNTHETIC_PASSWORD', '')],
  ['ordinary business database', url.replace(database, 'guardian')],
  ['test substring only', url.replace(database, 'contest')],
  ['shared staging test database', url.replace(database, 'guardian_test_staging')],
  ['test database without run isolation', url.replace(database, 'guardian_test')],
  ['different run name', url.replace(run, otherRun)], ['different worker name', url.replace('_w0', '_w1')],
  ['percent-encoded database path', url.replace('guardian_test', '%67uardian_test')],
  ['extra path segment', `${url}/other`], ['host override query', `${url}?host=staging.example.invalid`],
  ['database override query', `${url}?database=guardian`], ['user override query', `${url}?user=fictional`],
  ['socket override query', `${url}?host=%2Ffictional%2Fsocket`], ['pg options query', `${url}?options=synthetic`],
  ['empty query delimiter', `${url}?`], ['fragment', `${url}#synthetic`], ['empty fragment delimiter', `${url}#`],
  ['leading whitespace', ` ${url}`], ['embedded control character', url.replace('127.', '127.\n')],
  ['backslash ambiguity', url.replace('/guardian', '\\guardian')],
];
for (const field of ['GUARDIAN_TEST_DATABASE_URL', 'GUARDIAN_TEST_READONLY_DATABASE_URL'] as const) {
  for (const [name, value] of invalidUrls) {
    test(`integration target rejects ${name} in ${field} without I/O`, () => refuses({ ...valid, [field]: value }));
  }
}
