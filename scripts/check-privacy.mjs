import { lstat, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const disk = { lstat, readdir, readFile };
const textExtensions = /\.(?:[cm]?js|jsx|tsx?|css|html|json|txt|svg|md|ya?ml|xml)$/i;
const sourceExtensions = /\.(?:[cm]?js|jsx|tsx?|css|html|svg)$/i;
const forbiddenArtifact = /(?:^|\/)(?:\.env(?:[.-][^/]*)?|[^/]+\.(?:map|env|pem|key|p12|pfx|dump|backup|bak|sql|log|jsonl|zip|gz|tgz|tar|7z))$/i;
const forbiddenDirectory = /(?:^|\/)(?:\.git|node_modules|logs?|identities|secrets|backups?)(?:\/|$)/i;
const contractFiles = new Set(['contracts/openapi.yaml', 'contracts/README.md']);
const fixtureFiles = new Set([
  'web/src/mocks/fixtures/institutions.ts',
  'api/src/modules/archive/infrastructure/fixtures.ts',
]);
const testFiles = new Set([
  'web/src/test/archive.test.tsx',
  'web/src/test/archive-visibility.test.tsx',
  'web/src/test/archive-a11y.test.tsx',
  'web/src/lib/api/institution-adapter.test.ts',
  'web/src/lib/api/real-public-api.test.ts',
  'web/src/lib/api/validation.test.ts',
  'web/src/features/archive/institutions/query-state.test.ts',
]);
const generatedFiles = new Set([
  'web/src/lib/api/schema.d.ts',
  'api/src/infrastructure/openapi/generated.ts',
]);

// Exact, task-authorized synthetic values only. These are not secret exemptions.
// Scope/reason: existing fixture/test files and canonical contract examples;
// Human owner/review pending. These exact synthetic exceptions require review before release.
const fixtureMarkers = new Set([
  'fictional-mist-harbor-center', 'fictional-moon-bay-center',
  'fictional-paper-river-center', 'fictional-star-field-center', 'fictional-cloud-valley-center',
  'fictional-mist-region', 'fictional-moon-region', 'src-fictional-demo-notice',
  'evt-fictional-demo-notice', 'src-fictional-notice', 'fictional-notice',
  'fictional-mist-center', 'fictional-other-region', 'fictional-extra', 'fictional-any',
  'evt-fictional-notice', 'fictional-other',
  'fictional-first', 'fictional-returned', 'fictional-second', 'fictional-button', 'fictional-unsubmitted-draft',
  'fictional-draft', 'fictional-hidden', 'fictional-withdrawn',
  'fictional-center-', 'evt-fictional-page-', 'src-fictional-page-', 'src-fictional-page-21',
  '虚构示例·雾港成长中心', '虚构示例·雾港旧称', '虚构示例·月湾学习中心',
  '虚构示例·月湾学苑', '虚构示例·纸河研习中心', '虚构示例·星原教育中心',
  '虚构示例·星原课堂', '虚构示例·云谷研学中心', '虚构示例·公共资料演示署',
  '虚构示例·独立资料演示社', '虚构示例·雾港中心', '虚构示例·雾港资料演示通告',
  '虚构示例·雾省资料演示署', '虚构示例·资料演示通告发布', '虚构示例·资料索引建立',
]);
const probeMarkers = new Set([
  'fictional-private-probe', 'synthetic-private-probe',
  'synthetic-private-field', 'synthetic-internal-message',
]);
const generatedExamples = new Set([
  'fictional-mist-harbor-center', 'src-fictional-demo-notice', 'evt-fictional-demo-notice',
]);
const syntheticDatabaseUrls = new Set([
  'postgres://fictional-user:fictional-password@db.example.invalid/guardian_synthetic',
  'postgresql://fictional-user:fictional-password@db.example.invalid/guardian_synthetic',
]);
const sensitiveParameter = /token|secret|credential|password|passphrase|session|signature|authorization|(?:^|_)(?:auth|bearer|jwt|sid|pwd|pass|sig|sign|signed|key|apikey|accesskey|authkey|privatekey|awsaccesskeyid|googleaccessid|code|authcode|oauthcode)(?:_|$)|apikey|x_amz_|x_goog_/i;
const syntheticCredentialKeys = [
  'auth', 'authorization', 'bearer', 'jwt', 'session', 'sessionid', 'sid', 'pwd', 'pass',
  'sig', 'sign', 'signed', 'key', 'apikey', 'accesskey', 'authkey', 'privatekey',
  'awsaccesskeyid', 'googleaccessid', 'code', 'authcode', 'oauthcode', 'passphrase',
  'x-amz-date', 'x-goog-date', 'a!c!c!e!s!s!_!t!o!k!e!n',
];
const syntheticTestUrls = new Set([
  ...syntheticCredentialKeys.flatMap((key) => {
    const params = new URLSearchParams({ [key]: 'fictional-private-probe' }).toString();
    return [`?${params}`, `#${params}`, `#/reader?${params}`, `#${encodeURIComponent(params)}`]
      .map((suffix) => `https://example.invalid/${suffix}`);
  }),
  ...[
    '?page=2;token=fictional-private-probe', '?page=2?token=fictional-private-probe',
    '#/reader?page=2;token=fictional-private-probe', '#page%3D2%3Btoken%3Dfictional-private-probe',
    '?public_authorization_value=fictional-private-probe', '?public_session_value=fictional-private-probe',
    '?public_apikey_value=fictional-private-probe',
  ].map((suffix) => `https://example.invalid/${suffix}`),
  'https://fictional-user:fictional-password@example.invalid/',
  'https://fictional-user@example.invalid/',
  ...[
    'access_token', '%74oken', 'PassWord', 'api_key', 'X-Amz-Signature',
    'X-Goog-Credential', 'sig',
  ].map((key) => `https://example.invalid/?${key}=fictional-private-probe`),
  'https://example.invalid/#access_token=fictional-private-probe',
  ...[
    'localhost/fictional', 'fictional.localhost./', 'fictional/', 'fictional.local/',
    'fictional.internal/', 'fictional.intranet/', 'fictional.lan/', 'fictional.home/',
    'fictional.home.arpa/', '127.0.0.1/', '2130706433/', '0x7f000001/', '127.1/',
    '0.0.0.0/', '10.0.0.1/', '172.16.0.1/', '192.168.0.1/', '169.254.169.254/',
    '100.64.0.1/', '198.18.0.1/', '192.0.2.1/', '198.51.100.1/', '203.0.113.1/',
    '224.0.0.1/', '240.0.0.1/', '[::1]/', '[::]/', '[fd00::1]/', '[fe80::1]/',
    '[ff02::1]/', '[::ffff:127.0.0.1]/', '[2002:7f00:1::]/', '[2001:db8::1]/',
    '[2001:0:7f00:1::]/',
  ].map((host) => `http://${host}`),
]);

const rules = [
  ['personal-path', /(?:[A-Za-z]:[\\/](?:Users|projects)[\\/]|\/(?:Users|home)\/[A-Za-z0-9_.-]+\/)[^\s"'`<>]*/gi],
  ['database-url', /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'`<>]+/gi],
  ['private-key', /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/g],
  ['service-token', /\b(?:ghp_|github_pat_|sk-proj-|sk_live_|xox[baprs]-)[A-Za-z0-9_-]{12,}/g],
  ['secret-value', /\b(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["'][^"'\r\n]+["']/gi],
  ['development-fixture', /demo-campus|fictional-academy|示例档案[甲乙]|\b(?:src-|evt-)?fictional-[a-z0-9][a-z0-9_-]*|虚构示例·[\p{L}\p{N}]+/gu],
  ['synthetic-probe', /\b(?:synthetic|fictional|privacy)[-_](?:private|internal|secret|probe|sentinel)[A-Za-z0-9_-]*|Synthetic private note: must never appear in API responses/gi],
  ['private-field-value', /\b(?:private_note|internal_note|reviewer_note|internalNotes|raw_submission|submission_body|victim_identity)\b["']?\s*:\s*["'`][^"'`\r\n]+["'`]/g],
  ['private-url', /\b(?:https?|file|s3|gs):\/\/[^\s"'`<>]+/gi],
];

function privateUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const sensitiveParts = [url.search, url.hash].map((part) => {
      let decoded = part;
      for (let index = 0; index < 3; index += 1) {
        try {
          const next = decodeURIComponent(decoded);
          if (next === decoded) break;
          decoded = next;
        } catch { return 'token='; }
      }
      return decoded;
    });
    const sensitiveQuery = sensitiveParts.some((part) => part.split(/[?&#;]/).some((entry) => {
      if (!entry.includes('=')) return false;
      const key = entry.slice(0, entry.indexOf('=')).replaceAll('-', '_').replace(/[^A-Za-z0-9_]/g, '');
      return sensitiveParameter.test(key);
    }));
    return !['http:', 'https:'].includes(url.protocol) || Boolean(url.username || url.password)
      || !host.includes('.') || host.startsWith('[')
      || /^(?:0x[0-9a-f]+|\d+)(?:\.|$)/i.test(host)
      || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|home\.arpa)$/.test(host)
      || sensitiveQuery;
  } catch {
    return true;
  }
}

// React Router 7.18.4, MIT, production chunk-Q34X6AWR.mjs:
// createBrowserURLImpl (375–386) and DEFAULT_NAVIGATION_URL/getNavigatorCurrentUrl
// (1354–1363). Only their two exact reviewed compiled parsing contexts below
// are exceptions, not localhost links/configuration or arbitrary new URL calls.
// Only consistent identifier alpha-renaming/whitespace may vary. Library expression,
// property, literal or function-body changes fail closed; owner/review pending.
const routerParsingContexts = [
  {
    code: 'function yE(a,i,s=!1){let c="http://localhost";a&&(c=a.location.origin!=="null"?a.location.origin:a.location.href),Je(c,"No window.location.(origin|href) available to create URL");let o=typeof i=="string"?i:Li(i);return o=o.replace(/ $/,"%20"),!s&&zp.test(o)&&(o=c+o),new URL(o,c)}',
    parser: 'yE',
    identifiers: ['yE', 'a', 'i', 's', 'c', 'Je', 'o', 'Li', 'zp'],
  },
  {
    code: 'var Lv=new URL("http://localhost");function qp(a){if(a.createURL)return a.createURL("/");try{return new URL(a.createHref("/"),Lv)}catch{return Lv}}',
    parser: 'qp',
    fallback: 'Lv',
    identifiers: ['Lv', 'qp', 'a'],
  },
];

const identifierPattern = '[A-Za-z_$][A-Za-z0-9_$]*';
const forbiddenBindings = new Set([
  'fetch', 'sendBeacon', 'open', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'URL', 'window', 'navigator', 'location', 'function', 'var', 'let', 'const',
  'return', 'if', 'try', 'catch', 'new', 'typeof',
]);
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Template tokens are fixed; only these explicitly named bindings can be alpha-renamed. */
function compileRouterContext(context) {
  const groups = new Map();
  const tokens = context.code.match(/"(?:\\.|[^"\\])*"|\/ \$\/|[A-Za-z_$][A-Za-z0-9_$]*|!==|&&|==|[0-9]+|[^\s]/g);
  const pattern = tokens.map((token) => {
    if (!context.identifiers.includes(token)) return escapePattern(token);
    if (groups.has(token)) return `\\k<${groups.get(token)}>`;
    const group = `binding${groups.size}`;
    groups.set(token, group);
    return `(?<${group}>${identifierPattern})`;
  }).join('\\s*');
  return { ...context, groups, pattern: new RegExp(pattern, 'g') };
}
const compiledRouterContexts = routerParsingContexts.map(compileRouterContext);

function routerParsingBase(kind, file, value, content, index) {
  if (kind !== 'build' || !/^web\/dist\/.*\.(?:js|mjs|cjs)$/.test(file)
    || value !== 'http://localhost') return false;
  for (const { groups, pattern, parser, fallback } of compiledRouterContexts) {
    for (const context of content.matchAll(pattern)) {
      const start = context.index;
      const end = start + context[0].length;
      if (index !== start + context[0].indexOf(value)) continue;
      const bindings = Object.values(context.groups);
      // Distinct template bindings must remain distinct and cannot become network APIs.
      if (new Set(bindings).size !== bindings.length
        || bindings.some((binding) => forbiddenBindings.has(binding))) continue;
      // Require declaration boundaries, not fetch arguments, IIFEs or quoted examples.
      const before = content.slice(0, start).trimEnd();
      const after = content.slice(end).trimStart();
      if ((before && !/[;}]$/.test(before)) || /^[)(.`"']/.test(after)) continue;
      const outside = content.slice(0, start) + content.slice(end);
      const renamed = (binding) => escapePattern(context.groups[groups.get(binding)]);
      // No external use of the fallback (including fetch/new URL or mutated configuration).
      if (fallback && new RegExp(`(?<![A-Za-z0-9_$])${renamed(fallback)}(?![A-Za-z0-9_$])`).test(outside)) continue;
      // Direct/wrapped network use of the parser cannot inherit the parsing-base exception.
      if (new RegExp(`\\b(?:fetch|sendBeacon|open)\\s*\\([^;{}]*(?<![A-Za-z0-9_$])${renamed(parser)}\\s*\\(`).test(outside)) continue;
      return true;
    }
  }
  return false;
}

function exception(kind, file, rule, match, content, index) {
  if (rule === 'private-url' && routerParsingBase(kind, file, match, content, index)) return true;
  if (kind === 'build' || kind === 'report') return false;
  const knownFixture = kind === 'source' && (fixtureFiles.has(file) || testFiles.has(file));
  if (rule === 'database-url') return knownFixture && syntheticDatabaseUrls.has(match);
  if (rule === 'private-url') {
    return kind === 'source' && file === 'web/src/lib/api/validation.test.ts'
      && syntheticTestUrls.has(match);
  }
  if (rule === 'synthetic-probe') {
    return (knownFixture && probeMarkers.has(match))
      || (file === 'api/src/modules/archive/infrastructure/fixtures.ts'
        && match === 'Synthetic private note: must never appear in API responses');
  }
  if (rule === 'private-field-value') {
    const value = match.match(/["'`]([^"'`]+)["'`]$/)?.[1];
    return knownFixture && (probeMarkers.has(value)
      || (fixtureFiles.has(file) && value === 'Synthetic private note: must never appear in API responses'));
  }
  if (rule !== 'development-fixture') return false;
  if ((knownFixture || kind === 'contract') && fixtureMarkers.has(match)) return true;
  if (knownFixture && probeMarkers.has(match)) return true;
  if (knownFixture && ['fictional-user', 'fictional-password'].includes(match)) {
    const values = [...syntheticDatabaseUrls,
      ...(file === 'web/src/lib/api/validation.test.ts' ? syntheticTestUrls : [])];
    if (values.some((value) => {
      const start = content.lastIndexOf(value, index);
      return start >= 0 && index < start + value.length;
    })) return true;
  }
  // Generated declarations retain exactly these contract @example comments, not fixture payloads.
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = content.indexOf('\n', index);
  const line = content.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
  return kind === 'source' && generatedFiles.has(file) && generatedExamples.has(match)
    && line === `* @example ${match}`;
}

/** Pure content check. Returns rule categories only, never matched content. */
export function scanText(content, { kind, file }) {
  // Recognize the same values when a bundle/JSON report escapes slashes or characters.
  content = content.replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,
    (_match, unicode, hex) => String.fromCharCode(Number.parseInt(unicode ?? hex, 16)))
    .replaceAll('\\\\', '\\').replaceAll('\\/', '/');
  const failures = new Set();
  for (const [rule, pattern] of rules) {
    for (const match of content.matchAll(pattern)) {
      if (rule === 'private-url' && !privateUrl(match[0])) continue;
      if (!exception(kind, file, rule, match[0], content, match.index)) failures.add(rule);
    }
  }
  return [...failures];
}

function safeFile(file) {
  const parts = file.replaceAll('\\', '/').split('/');
  if (parts.some((part) => /^(?:Users|home)$/i.test(part))) return '[redacted-path]';
  return parts.map((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '..' ? part : '[redacted]').join('/');
}

function relativeInput(value) {
  return typeof value === 'string' && value.length > 0 && !isAbsolute(value)
    && !/^[A-Za-z]:|[\\\x00-\x1f]|^\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(value);
}

/** Fixed defaults cannot be removed by report/contract options. No whole-directory exclusions. */
export function scanTargets({ contracts = [], reports = [] } = {}) {
  const targets = [
    { kind: 'build', path: 'web/dist' },
    { kind: 'source', path: 'web/src' },
    { kind: 'source', path: 'api/src' },
  ];
  for (const path of contracts) targets.push({ kind: 'contract', path });
  for (const path of reports) targets.push({ kind: 'report', path });
  return targets;
}

/** Only safe code/default build and explicitly authorized report/contract paths are read. */
export async function scanProject({ root = projectRoot, contracts = [], reports = [], fs = disk } = {}) {
  const violations = [];
  const summaries = [];
  const fail = (file, rule) => violations.push({ file: safeFile(file), rule });
  for (const target of scanTargets({ contracts, reports })) {
    let scannedFiles = 0;
    if (!relativeInput(target.path) || (target.kind === 'contract' && !contractFiles.has(target.path))
      || (target.kind === 'report' && /^(?:api|web|contracts|scripts)(?:\/|$)/.test(target.path))) {
      fail('[target]', 'unauthorized-target');
      continue;
    }
    const targetRoot = resolve(root, target.path);
    async function visit(path) {
      const file = relative(root, path).split(sep).join('/');
      if (forbiddenArtifact.test(file) || forbiddenDirectory.test(file)) {
        fail(file, 'forbidden-artifact');
        return;
      }
      if (target.kind === 'build' && /(?:^|\/)(?:__tests__|__mocks__|fixtures?|tests?)(?:\/|$)|(?:\.test|\.spec)\.[^/]+$/i.test(file)) {
        fail(file, 'development-artifact');
        return;
      }
      let stat;
      try { stat = await fs.lstat(path); } catch { fail(file, 'filesystem-error'); return; }
      if (stat.isSymbolicLink()) { fail(file, 'symbolic-link'); return; }
      if (stat.isDirectory()) {
        let entries;
        try { entries = await fs.readdir(path, { withFileTypes: true }); } catch { fail(file, 'filesystem-error'); return; }
        for (const entry of entries) {
          if (!relativeInput(entry.name) || entry.name.includes('/')) { fail(file, 'invalid-entry'); continue; }
          await visit(join(path, entry.name));
        }
        return;
      }
      if (!stat.isFile()) { fail(file, 'unsupported-artifact'); return; }
      const extensions = target.kind === 'source' ? sourceExtensions : textExtensions;
      if (!extensions.test(file)) { fail(file, 'unsupported-artifact'); return; }
      let content;
      try { content = await fs.readFile(path); } catch { fail(file, 'filesystem-error'); return; }
      try {
        // Fatal decoding prevents malformed/binary attachments from being silently skipped.
        content = new TextDecoder('utf-8', { fatal: true }).decode(content);
      } catch { fail(file, 'invalid-text'); return; }
      if (!content.trim()) { fail(file, 'empty-file'); return; }
      if (content.includes('\0')) { fail(file, 'invalid-text'); return; }
      scannedFiles += 1;
      for (const rule of scanText(content, { kind: target.kind, file })) fail(file, rule);
    }
    // Check every ancestor, not just the target: web/src itself must not traverse a linked web/.
    let ancestor = resolve(root);
    let validAncestors = true;
    for (const part of ['', ...target.path.split('/').slice(0, -1)]) {
      ancestor = part ? join(ancestor, part) : ancestor;
      try {
        const stat = await fs.lstat(ancestor);
        if (stat.isSymbolicLink() || !stat.isDirectory()) { validAncestors = false; break; }
      } catch { validAncestors = false; break; }
    }
    if (validAncestors) await visit(targetRoot);
    else fail(target.path, 'unsafe-ancestor');
    if (scannedFiles === 0) fail(target.path, 'zero-scannable-files');
    summaries.push({ kind: target.kind, file: safeFile(target.path), scannedFiles });
  }
  return { ok: violations.length === 0, violations, summaries };
}

export function formatResult(result) {
  if (!result.ok) return result.violations.map(({ file, rule }) => `${file}: ${rule}`).join('\n');
  const count = result.summaries.reduce((total, target) => total + target.scannedFiles, 0);
  return `Privacy check passed: ${count} safe text files in ${result.summaries.length} targets.`;
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  const contracts = [];
  const reports = [];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const path = argv[index + 1];
    if (!['--contract', '--report'].includes(flag) || !relativeInput(path)) {
      return { exitCode: 1, output: '[arguments]: invalid-arguments' };
    }
    (flag === '--contract' ? contracts : reports).push(path);
  }
  try {
    const result = await scanProject({ ...options, contracts, reports });
    return { exitCode: result.ok ? 0 : 1, output: formatResult(result) };
  } catch {
    return { exitCode: 1, output: '[scanner]: scanner-error' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runCli();
  (result.exitCode ? process.stderr : process.stdout).write(`${result.output}\n`);
  process.exitCode = result.exitCode;
}
