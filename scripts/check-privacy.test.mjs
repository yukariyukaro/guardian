import assert from 'node:assert/strict';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { formatResult, runCli, scanProject, scanTargets, scanText } from './check-privacy.mjs';

// All filesystem operations are synthetic and in memory; never inspect or write real artifacts.
const root = resolve('synthetic-scanner-root');
const fixture = 'web/src/mocks/fixtures/institutions.ts';
const knownTest = 'web/src/lib/api/validation.test.ts';
const generated = 'web/src/lib/api/schema.d.ts';
const scan = (content, file = 'web/dist/assets/app.js', kind = 'build') => scanText(content, { file, kind });

function memoryFs(values = {}, failures = {}) {
  const nodes = new Map([['', { type: 'directory' }]]);
  for (const [path, content] of Object.entries(values)) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      nodes.set(parts.slice(0, index).join('/'), { type: 'directory' });
    }
    nodes.set(path, typeof content === 'string' || Buffer.isBuffer(content)
      ? { type: 'file', content } : content);
  }
  const reads = [];
  const key = (path) => relative(root, path).split(sep).join('/');
  const get = (path, operation) => {
    const name = key(path);
    if (failures[operation] === name || !nodes.has(name)) {
      throw new Error('Synthetic failure with /home/fictional-person/private-path and secret payload');
    }
    return nodes.get(name);
  };
  return {
    reads,
    async lstat(path) {
      const node = get(path, 'lstat');
      return {
        isSymbolicLink: () => node.type === 'link',
        isDirectory: () => node.type === 'directory',
        isFile: () => node.type === 'file',
      };
    },
    async readdir(path) {
      get(path, 'readdir');
      const directory = key(path);
      const prefix = directory ? `${directory}/` : '';
      return [...nodes.keys()].filter((name) => name.startsWith(prefix) && name !== directory
        && !name.slice(prefix.length).includes('/')).map((name) => ({ name: name.slice(prefix.length) }));
    },
    async readFile(path) {
      reads.push(key(path));
      return Buffer.from(get(path, 'readFile').content);
    },
  };
}
const safeFiles = {
  'web/dist/index.html': '<main>Safe public page</main>',
  'web/src/main.tsx': 'export const page = "Safe public page";',
  'api/src/config.ts': 'export type Mode = "mock" | "postgres";',
};
const check = (fs, options = {}) => scanProject({ root, fs, ...options });

test('default target whitelist cannot be replaced and optional paths are explicit', () => {
  assert.deepEqual(scanTargets().map(({ path }) => path), ['web/dist', 'web/src', 'api/src']);
  assert.deepEqual(scanTargets({ contracts: ['contracts/openapi.yaml'], reports: ['reports/public.txt'] })
    .map(({ path }) => path), ['web/dist', 'web/src', 'api/src', 'contracts/openapi.yaml', 'reports/public.txt']);
});

for (const [rule, content] of [
  ['personal-path', 'C:\\Users\\fictional-person\\private.txt'],
  ['personal-path', '/home/fictional-person/private.txt'],
  ['personal-path', 'D:/projects/synthetic/project'],
  ['database-url', 'postgresql://fictional-user:fictional-password@db.example.invalid/guardian_synthetic'],
  ['database-url', 'redis://cache.example.invalid/synthetic'],
  ['private-key', '-----BEGIN PRIVATE KEY-----'],
  ['private-key', '-----BEGIN ENCRYPTED PRIVATE KEY-----'],
  ['service-token', `ghp_${'synthetic'.repeat(4)}`],
  ['service-token', `github_pat_${'synthetic'.repeat(4)}`],
  ['service-token', `sk-proj-${'synthetic'.repeat(4)}`],
  ['secret-value', 'api_key: "synthetic-only-value"'],
  ['development-fixture', 'demo-campus fictional-academy 示例档案甲 示例档案乙'],
  ['development-fixture', 'fictional-mist-harbor-center'],
  ['development-fixture', 'src-fictional-demo-notice'],
  ['development-fixture', '虚构示例·雾港成长中心'],
  ['synthetic-probe', 'synthetic-private-probe'],
  ['synthetic-probe', 'fictional-private-probe'],
  ['synthetic-probe', 'privacy_probe_synthetic_001'],
  ['private-field-value', 'reviewer_note: "synthetic-only-note"'],
  ['private-url', 'https://fictional-user:fictional-password@example.invalid/'],
  ['private-url', 'https://example.invalid/?%74oken=synthetic-only-value'],
  ['private-url', 'https://example.invalid/#access_token=synthetic-only-value'],
  ['private-url', 'http://10.0.0.1/'],
  ['private-url', 'http://172.16.0.1/'],
  ['private-url', 'http://192.168.0.1/'],
  ['private-url', 'http://[::1]/'],
  ['private-url', 'https://fictional.internal/'],
  ['private-url', 'file:///synthetic/private.txt'],
  ['private-url', 's3://synthetic-private-bucket/item'],
]) {
  test(`build detects ${rule} synthetic case ${content.length}`, () => {
    assert.ok(scan(content).includes(rule));
  });
}

test('clean build accepts security enums, field names and public URL without false positives', () => {
  assert.deepEqual(scan('const security = ["password", "private", "email"]; const api_key = null; const url = "https://example.invalid/public";'), []);
  assert.deepEqual(scan('type Credential = { password: string; api_key?: string; private_note: string };', 'api/src/config.ts', 'source'), []);
});

// Exact reviewed React Router 7.18.4 MIT production compilation, not a generic localhost allowlist.
const routerParser = 'function yE(a,i,s=!1){let c="http://localhost";a&&(c=a.location.origin!=="null"?a.location.origin:a.location.href),Je(c,"No window.location.(origin|href) available to create URL");let o=typeof i=="string"?i:Li(i);return o=o.replace(/ $/,"%20"),!s&&zp.test(o)&&(o=c+o),new URL(o,c)}';
const routerNavigation = 'var Lv=new URL("http://localhost");function qp(a){if(a.createURL)return a.createURL("/");try{return new URL(a.createHref("/"),Lv)}catch{return Lv}}';

test('reviewed router parsing base and navigation fallback are allowed only in build JavaScript', () => {
  for (const content of [routerParser, routerNavigation, `function previous(){}${routerParser}function next(){}${routerNavigation}`]) {
    assert.deepEqual(scan(content), []);
    assert.ok(scan(content, 'reports/result.js', 'report').includes('private-url'));
    assert.ok(scan(content, 'web/src/library.js', 'source').includes('private-url'));
    assert.ok(scan(content, 'web/dist/index.html', 'build').includes('private-url'));
  }
});

test('localhost network requests and arbitrary build URL constants remain forbidden', () => {
  for (const content of [
    'fetch("http://localhost")',
    'fetch(new URL("http://localhost"))',
    'fetch(new URL("/", "http://localhost"))',
    'navigator.sendBeacon("http://localhost", "safe-body")',
    'const target = "http://localhost";',
    'const target = new URL("http://localhost");',
    'var DEFAULT_NAVIGATION_URL = new URL("http://localhost");',
    'const target = "http://localhost" + query;',
  ]) assert.ok(scan(content).includes('private-url'));
});

test('router context exact-value exception never permits localhost port, path, query or fragment', () => {
  for (const value of ['http://localhost/', 'http://localhost:3001', 'http://localhost/private',
    'http://localhost?sessionid=synthetic-only', 'http://localhost#access_token=synthetic-only',
    'https://localhost', 'http://127.0.0.1', 'http://fictional.internal']) {
    for (const context of [routerParser, routerNavigation]) {
      assert.ok(scan(context.replace('http://localhost', value)).includes('private-url'));
    }
  }
});

test('reviewed parser context cannot gain a networking call or variable suffix', () => {
  for (const content of [
    routerParser.replace('new URL(o,c)', 'fetch(new URL(o,c))'),
    routerNavigation.replace('new URL(a.createHref("/"),Lv)', 'fetch(new URL(a.createHref("/"),Lv))'),
    routerParser.replace('"http://localhost";', '"http://localhost"+query;'),
    routerNavigation.replace('new URL("http://localhost")', 'new URL("http://localhost"+query)'),
    `${routerNavigation};fetch(Lv);`,
    `${routerNavigation};fetch(new URL("/", Lv));`,
    `${routerParser};fetch(yE(window,"/"));`,
    `${routerNavigation};fetch(qp(navigator));`,
    `fetch(${routerParser})`,
    `(${routerParser})()`,
    `const source = \`${routerParser}\`;`,
    `/*${routerParser}*/`,
  ]) assert.ok(scan(content).includes('private-url'));
});

const alphaRename = (content, mapping) => content.replace(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g, (name) => mapping[name] ?? name);
const renamedParser = alphaRename(routerParser, {
  yE: 'parsePublicURL', a: 'browser', i: 'destination', s: 'absolute', c: 'base',
  Je: 'assertURL', o: 'href', Li: 'createPath', zp: 'relativePattern',
});
const renamedNavigation = alphaRename(routerNavigation, { Lv: 'navigationBase', qp: 'currentURL', a: 'router' });

test('complete reviewed router token structure allows consistent identifier alpha-renaming', () => {
  for (const content of [renamedParser, renamedNavigation, `${renamedParser};${renamedNavigation}`]) {
    assert.deepEqual(scan(content), []);
  }
  assert.deepEqual(scan(alphaRename(routerParser, { yE: '$parser', a: '$browser', c: '$base', o: '$href' })), []);
  assert.deepEqual(scan(alphaRename(routerNavigation, { Lv: '$navigation', qp: '$current', a: '$router' })), []);
});

test('alpha-renaming requires consistent references and distinct bindings', () => {
  for (const content of [
    renamedParser.replace('new URL(href,base)', 'new URL(href,otherBase)'),
    renamedParser.replace('browser.location.href', 'otherBrowser.location.href'),
    renamedNavigation.replace('catch{return navigationBase}', 'catch{return otherBase}'),
    alphaRename(routerParser, { a: 'same', i: 'same' }),
    alphaRename(routerNavigation, { Lv: 'same', a: 'same' }),
  ]) assert.ok(scan(content).includes('private-url'));
});

test('alpha-renamed parser and fallback cannot be used for networking', () => {
  for (const content of [
    `${renamedParser};fetch(parsePublicURL(window,"/"));`,
    `${renamedParser};fetch(new URL(parsePublicURL(window,"/")));`,
    `${renamedNavigation};fetch(navigationBase);`,
    `${renamedNavigation};fetch(new URL("/",navigationBase));`,
    `${renamedNavigation};navigator.sendBeacon(currentURL(navigator));`,
    alphaRename(routerParser, { Je: 'fetch' }),
    alphaRename(routerParser, { Li: 'fetch' }),
    alphaRename(routerParser, { yE: 'fetch' }),
  ]) assert.ok(scan(content).includes('private-url'));
});

test('alpha-renaming does not permit expression, property, string or body changes', () => {
  for (const content of [
    renamedParser.replace('new URL(href,base)', 'fetch(new URL(href,base))'),
    renamedParser.replace('base+href', 'base+query'),
    renamedParser.replace('!=="null"', '==="null"'),
    renamedParser.replace('location.origin', 'location.hostname'),
    renamedParser.replace('"http://localhost";', '"http://localhost"+query;'),
    renamedNavigation.replace('createHref("/")', 'createHref(query)'),
    renamedNavigation.replace('createURL("/")', 'createURL("/private")'),
  ]) assert.ok(scan(content).includes('private-url'));
});

test('router context matching fails closed on actual library structure drift', () => {
  for (const content of [
    routerParser.replace('location.origin', 'location.hostname'),
    routerNavigation.replace('catch{return Lv}', 'catch{return new URL("https://example.invalid")}'),
    'let base = "http://localhost";',
  ]) assert.ok(scan(content).includes('private-url'));
});

test('precise library exceptions do not hide a second private URL or any other rule', () => {
  for (const context of [routerParser, routerNavigation]) {
    assert.ok(scan(`${context};fetch("http://10.0.0.1/")`).includes('private-url'));
    for (const [value, rule] of [
      ['-----BEGIN PRIVATE KEY-----', 'private-key'],
      ['synthetic-private-probe', 'synthetic-probe'],
      ['fictional-mist-harbor-center', 'development-fixture'],
    ]) assert.ok(scan(`${context};const extra = "${value}";`).includes(rule));
  }
});

test('scanner checks full artifact while only excluding the reviewed router parsing constants', async () => {
  const fs = memoryFs({ ...safeFiles, 'web/dist/assets/app.js': `${routerParser};${routerNavigation}` });
  assert.equal((await check(fs)).ok, true);
  const unsafe = memoryFs({ ...safeFiles, 'web/dist/assets/app.js': `${routerParser};${routerNavigation};fetch("http://localhost")` });
  const result = await check(unsafe);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(({ file, rule }) => file === 'web/dist/assets/app.js' && rule === 'private-url'));
});

test('JSON and bundled escaped values are detected', () => {
  assert.ok(scan(JSON.stringify({ value: 'C:\\Users\\fictional-person\\private.txt' })).includes('personal-path'));
  assert.ok(scan('"postgresql:\\/\\/db.example.invalid/synthetic"').includes('database-url'));
  assert.ok(scan('"\\u0073ynthetic-private-probe"').includes('synthetic-probe'));
  assert.ok(scan('"\\u865a\\u6784\\u793a\\u4f8b·雾港成长中心"').includes('development-fixture'));
});

test('known source fixture and test markers are exact and not directory exemptions', () => {
  assert.deepEqual(scan('fictional-mist-harbor-center 虚构示例·雾港成长中心', fixture, 'source'), []);
  assert.deepEqual(scan('reviewer_note: "fictional-private-probe"', knownTest, 'source'), []);
  assert.ok(scan('fictional-unapproved-probe', fixture, 'source').includes('development-fixture'));
  assert.ok(scan('fictional-mist-harbor-center', 'web/src/mocks/fixtures/new.ts', 'source').includes('development-fixture'));
  assert.ok(scan('fictional-private-probe', 'web/src/new.test.ts', 'source').includes('synthetic-probe'));
  assert.ok(scan('demo-campus', fixture, 'source').includes('development-fixture'));
});

test('source fixture exceptions never permit actual key, token, path or arbitrary private note', () => {
  for (const file of [fixture, knownTest]) {
    for (const [rule, value] of [
      ['private-key', '-----BEGIN PRIVATE KEY-----'],
      ['service-token', `ghp_${'synthetic'.repeat(4)}`],
      ['personal-path', '/home/fictional-person/private.txt'],
      ['private-field-value', 'reviewer_note: "not-an-approved-synthetic-probe"'],
    ]) assert.ok(scan(value, file, 'source').includes(rule));
  }
});

test('synthetic postgres examples are limited to known source fixture/test files', () => {
  const value = 'postgresql://fictional-user:fictional-password@db.example.invalid/guardian_synthetic';
  assert.deepEqual(scan(value, fixture, 'source'), []);
  for (const [file, kind] of [['web/dist/app.js', 'build'], ['reports/test.txt', 'report'], ['api/src/config.ts', 'source']]) {
    assert.ok(scan(value, file, kind).includes('database-url'));
  }
  assert.ok(scan('postgresql://fictional-user:fictional-password@other.example.invalid/guardian_synthetic', fixture, 'source').includes('database-url'));
});

test('URL rejection probes are exact and scoped to the known URL-safety test', () => {
  for (const value of ['http://10.0.0.1/', 'https://fictional-user:fictional-password@example.invalid/', 'https://example.invalid/?%74oken=fictional-private-probe']) {
    assert.deepEqual(scan(value, knownTest, 'source'), []);
    assert.ok(scan(value, fixture, 'source').includes('private-url'));
    assert.ok(scan(value).includes('private-url'));
  }
  assert.ok(scan('http://10.0.0.2/', knownTest, 'source').includes('private-url'));
});

test('generated declaration documentation is not fixture payload but is still scanned', () => {
  const content = '/** @description 不含私有审核笔记、联系方式或私人信息 */\n/**\n * @example fictional-mist-harbor-center\n */\nInstitutionSlug: string;';
  assert.deepEqual(scan(content, generated, 'source'), []);
  assert.ok(scan('const slug = "fictional-mist-harbor-center";', generated, 'source').includes('development-fixture'));
  assert.ok(scan(' * @example fictional-unapproved-center', generated, 'source').includes('development-fixture'));
  assert.ok(scan(`${content}\n-----BEGIN PRIVATE KEY-----`, generated, 'source').includes('private-key'));
});

test('explicit canonical contract examples are allowed but reports and builds are strict', () => {
  assert.deepEqual(scan('slug: fictional-mist-harbor-center', 'contracts/openapi.yaml', 'contract'), []);
  for (const kind of ['build', 'report']) {
    assert.ok(scan('fictional-mist-harbor-center', 'reports/result.txt', kind).includes('development-fixture'));
    assert.ok(scan('synthetic-private-probe', 'reports/result.txt', kind).includes('synthetic-probe'));
  }
});

test('safe files are counted in each default target; backend folders outside api/src are never visited', async () => {
  const fs = memoryFs({ ...safeFiles, 'api/private/not-authorized.txt': 'not to be read' });
  const result = await check(fs);
  assert.equal(result.ok, true);
  assert.deepEqual(result.summaries.map(({ scannedFiles }) => scannedFiles), [1, 1, 1]);
  assert.equal(fs.reads.includes('api/private/not-authorized.txt'), false);
  assert.match(formatResult(result), /3 safe text files in 3 targets/);
});

for (const [name, values] of [
  ['missing build', { 'web/src/main.tsx': 'safe', 'api/src/config.ts': 'safe' }],
  ['empty directory', { ...safeFiles, 'web/dist/index.html': { type: 'directory' } }],
  ['empty file', { ...safeFiles, 'web/dist/index.html': '' }],
  ['whitespace file', { ...safeFiles, 'web/dist/index.html': ' \n\t' }],
  ['unscannable attachment', { ...safeFiles, 'web/dist/index.html': { type: 'directory' }, 'web/dist/probe.png': Buffer.from([1, 2, 3]) }],
  ['malformed text', { ...safeFiles, 'web/dist/index.html': Buffer.from([0xff]) }],
  ['binary text', { ...safeFiles, 'web/dist/index.html': 'safe\0binary' }],
]) test(`${name} fails closed`, async () => assert.equal((await check(memoryFs(values))).ok, false));

test('one empty file fails even when other files are scannable', async () => {
  const result = await check(memoryFs({ ...safeFiles, 'web/dist/assets/empty.js': '' }));
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(({ rule }) => rule === 'empty-file'));
});

for (const extension of ['map', 'env', 'pem', 'key', 'dump', 'backup', 'log', 'jsonl', 'zip']) {
  test(`forbidden ${extension} artifact is rejected without reading`, async () => {
    const path = `web/dist/probe.${extension}`;
    const fs = memoryFs({ ...safeFiles, [path]: 'must not be read' });
    const result = await check(fs);
    assert.equal(result.ok, false);
    assert.equal(fs.reads.includes(path), false);
    assert.ok(result.violations.some(({ rule }) => rule === 'forbidden-artifact'));
  });
}

test('environment files and private directories are rejected before any content read', async () => {
  const fs = memoryFs({ ...safeFiles, 'web/src/.env.local': 'must not be read', 'api/src/secrets/value.ts': 'must not be read' });
  const result = await check(fs);
  assert.equal(result.ok, false);
  assert.equal(fs.reads.includes('web/src/.env.local'), false);
  assert.equal(fs.reads.includes('api/src/secrets/value.ts'), false);
});

test('symlink files, directories, and ancestors fail without traversal', async () => {
  for (const path of ['web/dist/index.html', 'web', 'api/src/link']) {
    const fs = memoryFs({ ...safeFiles, [path]: { type: 'link' } });
    assert.equal((await check(fs)).ok, false);
    assert.equal(fs.reads.includes(path), false);
  }
});

for (const operation of ['lstat', 'readdir', 'readFile']) {
  test(`${operation} errors never leak exceptions or payload`, async () => {
    const fs = memoryFs(safeFiles, { [operation]: operation === 'readdir' ? 'web/dist' : 'web/dist/index.html' });
    const result = await check(fs);
    assert.equal(result.ok, false);
    const output = formatResult(result);
    assert.equal(output.includes('fictional-person'), false);
    assert.equal(output.includes('secret payload'), false);
    assert.equal(output.includes(root), false);
  });
}

test('violations only contain relative filename and rule; unsafe identity filenames are redacted', async () => {
  const fs = memoryFs({ ...safeFiles, 'web/dist/fictional person@example.invalid.js': '/home/fictional-person/private.txt' });
  const result = await check(fs);
  const output = formatResult(result);
  assert.match(output, /web\/dist\/\[redacted\]: personal-path/);
  assert.equal(output.includes('fictional-person'), false);
  assert.equal(output.includes('person@example.invalid'), false);
  assert.equal(output.includes(root), false);
  assert.ok(result.violations.every((item) => Object.keys(item).join(',') === 'file,rule'));
});

test('new known regression test fixtures are exact and never exempt a build', () => {
  const file = 'web/src/test/archive-a11y.test.tsx';
  assert.deepEqual(scan('fictional-first fictional-returned fictional-private-probe', file, 'source'), []);
  assert.ok(scan('fictional-first fictional-returned fictional-private-probe').includes('synthetic-probe'));
  assert.ok(scan('fictional-unreviewed-query', file, 'source').includes('development-fixture'));
  assert.deepEqual(scan('fictional-other evt-fictional-notice', knownTest, 'source'), []);
});

test('sensitive URL keys/encoded separators are detected and exact known URL probes remain allowed', () => {
  for (const suffix of [
    '?sessionid=fictional-private-probe', '#/reader?auth=fictional-private-probe',
    '#sessionid%3Dfictional-private-probe', '?page=2;token=fictional-private-probe',
    '?public_session_value=fictional-private-probe', '?public_apikey_value=fictional-private-probe',
  ]) {
    const value = `https://example.invalid/${suffix}`;
    assert.deepEqual(scan(value, knownTest, 'source'), []);
    assert.ok(scan(value).includes('private-url'));
    assert.ok(scan(value, fixture, 'source').includes('private-url'));
  }
  assert.ok(scan('https://example.invalid/?sessionid=unapproved-value', knownTest, 'source').includes('private-url'));
  assert.deepEqual(scan('https://example.invalid/?page=2&lang=zh#section'), []);
});

test('build fixture/test artifacts fail even without a legacy fixture marker', async () => {
  const fs = memoryFs({ ...safeFiles, 'web/dist/fixtures/clean.js': 'safe-looking text', 'web/dist/assets/clean.test.js': 'safe-looking text' });
  const result = await check(fs);
  assert.equal(result.ok, false);
  assert.equal(result.violations.filter(({ rule }) => rule === 'development-artifact').length, 2);
  assert.equal(fs.reads.includes('web/dist/fixtures/clean.js'), false);
});

test('optional contract and report targets are actually checked and missing optional paths fail', async () => {
  const fs = memoryFs({ ...safeFiles, 'contracts/openapi.yaml': 'slug: fictional-mist-harbor-center', 'reports/result.txt': 'synthetic-private-probe' });
  assert.equal((await check(fs)).ok, true);
  const result = await check(fs, { contracts: ['contracts/openapi.yaml'], reports: ['reports/result.txt'] });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(({ file, rule }) => file === 'reports/result.txt' && rule === 'synthetic-probe'));
  assert.equal((await check(fs, { reports: ['reports/missing.txt'] })).ok, false);
});

test('optional targets reject traversal, absolute paths, environment, backend and non-whitelisted contracts', async () => {
  for (const path of ['../outside', '/home/fictional-person/private.txt', 'C:\\Users\\fictional-person\\private.txt', 'api/private', 'web/src', 'scripts/check-privacy.mjs']) {
    const fs = memoryFs(safeFiles);
    assert.equal((await check(fs, { reports: [path] })).ok, false);
    assert.equal(fs.reads.length, 3);
  }
  const fs = memoryFs({ ...safeFiles, 'reports/.env': 'must not be read' });
  assert.equal((await check(fs, { reports: ['reports/.env'] })).ok, false);
  assert.equal(fs.reads.includes('reports/.env'), false);
  assert.equal((await check(fs, { contracts: ['contracts/not-authorized.yaml'] })).ok, false);
});

test('CLI returns failure codes safely and only accepts repeatable explicit flags', async () => {
  assert.equal((await runCli([], { root, fs: memoryFs(safeFiles) })).exitCode, 0);
  for (const argv of [['--unknown', 'synthetic'], ['--report'], ['--report', join(root, 'outside')], ['--root', 'synthetic']]) {
    const result = await runCli(argv, { root, fs: memoryFs(safeFiles) });
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.includes('outside'), false);
  }
  assert.equal((await runCli(['--report', 'reports/missing.txt'], { root, fs: memoryFs(safeFiles) })).exitCode, 1);
  const fs = memoryFs(safeFiles);
  const unexpected = await runCli([], { root, fs: {
    async lstat(path) {
      if (path === join(root, 'web', 'dist')) return { isSymbolicLink() { throw new Error('Synthetic private error'); } };
      return fs.lstat(path);
    },
  } });
  assert.deepEqual(unexpected, { exitCode: 1, output: '[scanner]: scanner-error' });
});
