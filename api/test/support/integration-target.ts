export interface IntegrationTargets {
  readonly maintenanceUrl: string;
  readonly readonlyUrl: string;
}

const refusal = 'UNEXECUTED: Integration requires NODE_ENV=test, an approved disposable synthetic target, and matching loopback run/worker database URLs';
function reject(): never { throw new Error(refusal); }

/** Pure preflight: no environment lookup, I/O, URL logging, Pool construction or database access. */
export function validateIntegrationTargets(env: Readonly<Record<string, string | undefined>>): IntegrationTargets {
  const run = env.GUARDIAN_TEST_RUN_ID;
  const worker = env.GUARDIAN_TEST_WORKER_ID;
  if (env.NODE_ENV !== 'test' || !run || !/^[a-f0-9]{32}$/.test(run)
    || !worker || !/^(?:0|[1-9][0-9]{0,3})$/.test(worker)
    || env.GUARDIAN_TEST_TARGET_APPROVAL !== `synthetic-disposable:${run}`) reject();
  const database = `guardian_test_${run}_w${worker}`;

  const validateUrl = (value: string | undefined): { connectionString: string; url: URL } => {
    if (!value || /[\s\\]/.test(value) || value.includes('?') || value.includes('#')) reject();
    let url: URL;
    try { url = new URL(value); } catch { reject(); }
    // Literal loopback only: no DNS, remote/shared staging, socket paths or pg query overrides.
    // Every connection field is explicit, so pg cannot fill it from ordinary PG* environment values.
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || !url.username || !url.password || !url.port || Number(url.port) < 1
      || url.pathname !== `/${database}`) reject();
    return { connectionString: value, url };
  };

  // There is deliberately no TEST_DATABASE_URL or ordinary DATABASE_URL fallback.
  const maintenance = validateUrl(env.GUARDIAN_TEST_DATABASE_URL);
  const readonly = validateUrl(env.GUARDIAN_TEST_READONLY_DATABASE_URL);
  if (maintenance.url.hostname !== readonly.url.hostname || maintenance.url.port !== readonly.url.port
    || maintenance.url.pathname !== readonly.url.pathname) reject();
  return { maintenanceUrl: maintenance.connectionString, readonlyUrl: readonly.connectionString };
}
