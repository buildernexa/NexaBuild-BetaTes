import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { UUID_RE, validateBuildMetadata } from '../lib/nexa.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('build ID uses UUID v4 format accepted by workflow', () => {
  assert.match('b2e7c7de-a1e4-4d6d-9a62-59b5b1cc2b6f', UUID_RE);
  assert.doesNotMatch('nexa-123', UUID_RE);
});

test('build metadata validates and normalizes version code', () => {
  assert.deepEqual(validateBuildMetadata({
    appName: 'Nexa Demo', packageId: 'com.nexa.demo', version: '1.2.3', versionCode: '7',
  }), { appName: 'Nexa Demo', packageId: 'com.nexa.demo', version: '1.2.3', versionCode: '7' });
  assert.throws(() => validateBuildMetadata({ appName: 'X', packageId: 'com..broken', version: '1', versionCode: 1 }));
});

test('index.html is standalone for CSS and dashboard JavaScript', async () => {
  const html = await read('index.html');
  assert.match(html, /<style id="nexabuild-inline-style">/);
  assert.match(html, /<script id="nexabuild-inline-jszip">/);
  assert.match(html, /<script id="nexabuild-inline-workflow-state">/);
  assert.match(html, /<script id="nexabuild-inline-app">/);
  assert.match(html, /<script id="nexabuild-inline-revision">/);
  assert.doesNotMatch(html, /(?:href|src)=["']assets\/(?:style\.css|app\.js|nexa-revision\.js|vendor\/jszip\.min\.js)["']/i);
});

test('inline JavaScript parses and app has no native blocking dialogs', async () => {
  const html = await read('index.html');
  const scripts = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length >= 3);
  for (const source of scripts) if (source.trim()) new vm.Script(source);
  assert.doesNotMatch(html, /\b(?:alert|confirm|prompt)\s*\(/);
});

test('workflow publishes named APK Release asset and supports requested permissions', async () => {
  const workflow = await read('.github/workflows/build.yml');
  for (const value of ['workflow_dispatch', 'internet_mode', 'camera_permission', 'wake_lock', 'vibrate_permission', 'archive_sha256', 'archive_size', 'chunk_count', 'reassemble_upload.py', 'verify_apk.py', 'gh release create', 'NexaBuild-${UPLOAD_ID}.apk']) {
    assert.ok(workflow.includes(value), `workflow should include ${value}`);
  }
});


test('Capacitor configuration uses JSON and cannot require TypeScript', async () => {
  const workflow = await read('.github/workflows/build.yml');
  const writer = await read('scripts/write_capacitor_config.py');
  assert.match(workflow, /write_capacitor_config\.py/);
  assert.match(workflow, /capacitor\.config\.json/);
  assert.doesNotMatch(workflow, /writeFileSync\(['"]capacitor\.config\.ts/);
  assert.match(writer, /json\.dumps\(config/);
  assert.match(workflow, /npx cap add android/);
  assert.match(workflow, /timeout-minutes: 45/);
});

test('GitHub Actions failure and skipped steps never become false 100 percent success', async () => {
  const source = await read('assets/workflow-state.js');
  const sandbox = {};
  vm.runInNewContext(source, { globalThis: sandbox });
  const state = sandbox.NexaWorkflowState;
  assert.equal(state.normalizeConclusion('failure'), 'failed');
  assert.equal(state.normalizeConclusion('timed_out'), 'failed');
  assert.equal(state.stageIndex('Run NexaBuild regression and configuration tests'), 1);
  assert.equal(state.stageIndex('Post Checkout builder'), -1);
  const steps = [
    { name: 'Validate build inputs', status: 'completed', conclusion: 'success' },
    { name: 'Create Capacitor Android wrapper', status: 'completed', conclusion: 'failure' },
    { name: 'Configure Android identity and launcher icons', status: 'completed', conclusion: 'skipped' },
    { name: 'Compile Android APK with Gradle', status: 'completed', conclusion: 'skipped' },
    { name: 'Post Checkout builder', status: 'completed', conclusion: 'success' }
  ];
  const snapshot = state.getStepSnapshot(steps);
  assert.equal(snapshot.total, 2);
  assert.equal(snapshot.successful, 1);
  assert.equal(snapshot.failed, 1);
  assert.equal(snapshot.skipped, 2);
  assert.ok(snapshot.progress < 100);
  assert.equal(state.findRelevantStep(steps).name, 'Create Capacitor Android wrapper');
  const stages = state.getStageStates(steps, 'failure');
  assert.equal(stages[0].state, 'done');
  assert.equal(stages[4].state, 'failed');
  assert.equal(stages[5].state, 'pending');
});

test('workflow runs preflight tests and exposes distinct Capacitor, configuration, Gradle and APK verification steps', async () => {
  const workflow = await read('.github/workflows/build.yml');
  for (const name of [
    'Run NexaBuild regression and configuration tests',
    'Create Capacitor Android wrapper',
    'Configure Android identity and launcher icons',
    'Compile Android APK with Gradle',
    'Verify APK signature and metadata'
  ]) assert.ok(workflow.includes(name), `workflow should include ${name}`);
});

test('build UI has all four module nav items and requested labels', async () => {
  const html = await read('index.html');
  for (const id of ['view-home', 'view-build', 'view-results', 'view-chat', 'memberCount', 'presenceCount', 'buildTotalCount', 'buildSuccessCount', 'quranFullscreen', 'downloadFallback']) {
    assert.ok(html.includes(`id="${id}"`), `index should include ${id}`);
  }
});

test('source framework previews and uploads use the same compiled output', async () => {
  const app = await read('assets/app.js');
  const workflow = await read('scripts/prepare_site.py');
  assert.match(app, /builtCandidates = \['dist\/index\.html','build\/index\.html','www\/index\.html','out\/index\.html'\]/);
  assert.match(app, /if \(hasFrameworkSource\) return null/);
  assert.match(workflow, /"out\/index\.html"/);
  assert.match(workflow, /"out"/);
});

test('GitHub state JSON fails closed instead of overwriting corrupt community/history files', async () => {
  const revision = await read('assets/nexa-revision.js');
  assert.match(revision, /berisi JSON rusak/);
  assert.match(revision, /Data tidak akan ditimpa otomatis/);
  assert.match(revision, /preferIncoming/);
});

test('private chat attachments are scoped to one safe file inside chat-assets', async () => {
  const revision = await read('assets/nexa-revision.js');
  assert.match(revision, /folder !== parts\.length - 3/);
  assert.match(revision, /A-Za-z0-9\]\[A-Za-z0-9\._-/);
  assert.match(revision, /Lampiran melebihi batas GlobalChat 15 MB/);
  assert.match(revision, /const privateAssetAttribute = chatAssetPath\(url\.href\)/);
});

test('upload dispatch ambiguity does not delete a branch that a runner may need', async () => {
  const revision = await read('assets/nexa-revision.js');
  assert.match(revision, /definitiveRejection/);
  assert.match(revision, /[Bb]ranch upload sementara sengaja dipertahankan/);
});

test('GitHub release URLs support release-assets subdomains but require a non-empty APK', async () => {
  const revision = await read('assets/nexa-revision.js');
  const app = await read('assets/app.js');
  assert.match(revision, /endsWith\('\.githubusercontent\.com'\)/);
  assert.match(revision, /asset\.size > 0/);
  assert.match(app, /endsWith\('\.githubusercontent\.com'\)/);
});

test('build icon conversion is guarded so mobile decode failures do not create stuck jobs', async () => {
  const app = await read('assets/app.js');
  assert.match(app, /let iconDataUrl;[\s\S]*?iconDataUrl = await getAppIconDataUrl\(\);[\s\S]*?catch \(error\) \{[\s\S]*?updateBuildReadiness\(\);[\s\S]*?return;/);
  assert.match(app, /iconDataUrl,$/m);
});


test('storage access is guarded for file origins and restricted mobile browsers', async () => {
  const app = await read('assets/app.js');
  const revision = await read('assets/nexa-revision.js');
  assert.match(app, /window\.localStorage\.getItem\(key\)[\s\S]*?catch/);
  assert.match(revision, /window\.localStorage\.setItem\(key, String\(value\)\)[\s\S]*?catch/);
});

test('global chat can page older comments instead of stopping at 100', async () => {
  const html = await read('index.html');
  const revision = await read('assets/nexa-revision.js');
  assert.match(html, /id="chatLoadOlder"/);
  assert.match(revision, /function loadOlderChat\(\)/);
  assert.match(revision, /direction=desc&page=\$\{page\}/);
  assert.match(revision, /insertAdjacentHTML\('afterbegin'/);
});

test('desktop bottom navigation has a stable four-column layout', async () => {
  const css = await read('assets/style.css');
  assert.match(css, /\.bottom-nav\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test('server upload finalizer preserves an input branch on an ambiguous dispatch result', async () => {
  const finalize = await read('api/upload/finalize.js');
  assert.match(finalize, /dispatchAttempted/);
  assert.match(finalize, /definitiveDispatchRejection/);
  assert.match(finalize, /status: 'dispatch_uncertain'/);
  assert.match(finalize, /Branch upload tetap dipertahankan/);
});

test('workflow failure UI does not guess a failing Capacitor step when GitHub reports another failure', async () => {
  const app = await read('assets/app.js');
  const revision = await read('assets/nexa-revision.js');
  assert.doesNotMatch(app, /record\.failedStep \|\| error\.failedStep \|\| 'Create Capacitor Android wrapper'/);
  assert.match(revision, /workflowState\.stageIndex\(step\.name\) >= 0 && \['failure'/);
  assert.match(app, /workflowFailure && \(record\.failedStep \|\| error\.failedStep\)/);
});

test('standalone HTML embeds the current source CSS and JavaScript exactly', async () => {
  const html = await read('index.html');
  const css = await read('assets/style.css');
  const app = await read('assets/app.js');
  const revision = await read('assets/nexa-revision.js');
  const helper = await read('assets/workflow-state.js');
  assert.equal(html.match(/<style id="nexabuild-inline-style">([\s\S]*?)<\/style>/)?.[1], css.trimEnd());
  assert.equal(html.match(/<script id="nexabuild-inline-workflow-state">([\s\S]*?)<\/script>/)?.[1], helper.trimEnd());
  assert.equal(html.match(/<script id="nexabuild-inline-app">([\s\S]*?)<\/script>/)?.[1], app.trimEnd());
  assert.equal(html.match(/<script id="nexabuild-inline-revision">([\s\S]*?)<\/script>/)?.[1], revision.trimEnd());
});

test('GitHub build polling allows a full hour for queue delays and matches its timeout message', async () => {
  const revision = await read('assets/nexa-revision.js');
  assert.match(revision, /while \(attempts < 720\)/);
  assert.match(revision, /batas polling 60 menit/);
  assert.doesNotMatch(revision, /batas polling 30 menit/);
});

test('ZIP validation and framework output selection protect memory and preview-build consistency', async () => {
  const app = await read('assets/app.js');
  const backend = await read('scripts/prepare_site.py');
  assert.match(app, /function validateArchiveEntries\(entries\)/);
  assert.match(app, /maxFiles = 10000, maxTotal = 160 \* 1024 \* 1024, maxSingle = 80 \* 1024 \* 1024/);
  assert.match(app, /unsafeOriginalName/);
  assert.match(app, /dist\/\<app\>/);
  assert.match(app, /folderIndex/);
  assert.match(backend, /nested_outputs/);
  assert.match(backend, /"dist", "build", "www", "out"/);
});


test('frontend ZIP size matches the 40 MiB server and workflow upload cap', async () => {
  const app = await read('assets/app.js');
  const backend = await read('lib/nexa.js');
  const workflow = await read('.github/workflows/build.yml');
  assert.match(app, /file\.size > 40 \* 1024 \* 1024/);
  assert.match(backend, /MAX_PROJECT_BYTES = 40 \* 1024 \* 1024/);
  assert.match(workflow, /40 \* 1024 \* 1024/);
  assert.doesNotMatch(app, /file\.size > 300 \* 1024 \* 1024/);
});




test('GlobalChat rejects orphan attachments before upload and ignores stale room responses', async () => {
  const revision = await read('assets/nexa-revision.js');
  assert.match(revision, /if \(!configuredIssue\(\)\) \{ openOverlay\('chatConfigOverlay'\); throw new Error\('Atur nomor GitHub Issue terlebih dahulu/);
  assert.match(revision, /chatLoadSequence: 0/);
  assert.match(revision, /if \(sequence !== state\.chatLoadSequence\) return/);
  assert.match(revision, /finally \{ if \(sequence === state\.chatLoadSequence\)/);
  assert.match(revision, /const ext = \(\{'image\/webp':'webp','image\/png':'png','image\/jpeg':'jpg'\}\)\[type\]/);
});

test('temporary upload branch creation verifies a potentially lost GitHub response', async () => {
  const revision = await read('assets/nexa-revision.js');
  assert.match(revision, /GitHub may create the ref but the response can time out/);
  assert.match(revision, /createdRef\?\.object\?\.sha !== commit\.sha/);
  assert.match(revision, /githubGet\(`\$\{repoBase\(\)\}\/git\/ref\/heads\/\$\{enc\(uploadRef\)\}`\)/);
});

test('ambiguous workflow dispatch is preserved as uncertain instead of falsely marked failed', async () => {
  const app = await read('assets/app.js');
  const revision = await read('assets/nexa-revision.js');
  assert.match(revision, /uncertain\.code = 'NEXA_DISPATCH_UNCERTAIN'/);
  assert.match(revision, /uncertain\.uploadRef = upload\.uploadRef/);
  assert.match(app, /const dispatchUncertain = error\?\.code === 'NEXA_DISPATCH_UNCERTAIN'/);
  assert.match(app, /record\.status = workflowFailure \? 'failed' : releaseUncertain \? 'publication_failed'/);
  assert.match(app, /Jangan mengirim ulang sebelum memeriksa Actions/);
});

test('drawer settings actions are not double-bound by the legacy base script', async () => {
  const app = await read('assets/app.js');
  const revision = await read('assets/nexa-revision.js');
  assert.doesNotMatch(app, /drawerProfile.*addEventListener/);
  assert.doesNotMatch(app, /drawerEngineTest.*addEventListener/);
  assert.match(revision, /drawerProfile.*addEventListener/);
  assert.match(revision, /drawerEngineTest.*addEventListener/);
});

test('project loading ignores stale asynchronous ZIP reads and restores canceled sticker selection mode', async () => {
  const app = await read('assets/app.js');
  const revision = await read('assets/nexa-revision.js');
  assert.match(app, /let projectLoadSequence = 0/);
  assert.match(app, /if \(loadSequence !== projectLoadSequence\) return/);
  assert.match(app, /projectLoadSequence\+\+/);
  assert.match(revision, /sendChatPhoto[\s\S]*dataset\.sticker = '0'/);
  assert.match(revision, /Foto\/stiker harus berupa PNG, JPG, WEBP, atau GIF/);
});

test('Keystore copy button is created before use and static UI references resolve', async () => {
  const html = await read('index.html');
  const revision = await read('assets/nexa-revision.js');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const refs = new Set([...html.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]));
  const dynamic = new Set(['copyKeystoreBase64']);
  for (const ref of refs) assert.ok(ids.has(ref) || dynamic.has(ref), `missing UI element: ${ref}`);
  assert.match(revision, /if \(!copy\) \{ copy = document\.createElement\('button'\); copy\.id = 'copyKeystoreBase64';/);
  assert.match(revision, /\$\('keystoreResult'\)\.after\(copy\)/);
});

test('mobile layout keeps dialogs scrollable and the four module navigation aligned', async () => {
  const css = await read('assets/style.css');
  assert.match(css, /\.dialog-card\{[^}]*max-height:min\(92dvh/);
  assert.match(css, /\.bottom-nav\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /\.build-layout\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.settings-three\{grid-template-columns:1fr\}/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});


test('new mobile-first Neobrutalism shell removes horizontal swipe clutter', async () => {
  const html = await read('index.html');
  const css = await read('assets/style.css');
  assert.match(html, /id="moduleTitle">NEXA STUDIO/);
  assert.doesNotMatch(html, /class="info-ticker/);
  assert.doesNotMatch(html, /class="quick-module-grid/);
  assert.match(css, /overflow-x:hidden/);
  assert.match(css, /touch-action:pan-y/);
  assert.match(css, /--lime:#d7f45b/);
});


test('clear glass theme is the default and has visible transparency without global blur', async () => {
  const css = await read('assets/style.css');
  const revision = await read('assets/nexa-revision.js');
  assert.match(revision, /theme: 'nexabuild\.theme\.v3'/);
  assert.match(revision, /applyTheme\(storageGet\(KEYS\.theme\) \|\| 'glass'\)/);
  assert.match(css, /body\[data-theme=glass\] \.glass[\s\S]*?background:rgba\(255,255,255,\.58\)/);
  assert.match(css, /backdrop-filter:none/);
  assert.match(revision, /const value = theme === 'neo' \? 'neo' : 'glass'/);
});

test('upload branch includes a SHA-256 manifest and workflow UI avoids invented step progress', async () => {
  const revision = await read('assets/nexa-revision.js');
  const workflow = await read('.github/workflows/build.yml');
  assert.match(revision, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(revision, /archiveSha256/);
  assert.match(revision, /WORKFLOW STEPS \(\$\{stepLabel\}\)/);
  assert.match(workflow, /archive_sha256/);
  assert.match(workflow, /reassemble_upload\.py/);
  assert.match(workflow, /verify_apk\.py/);
  assert.match(revision, /loggedStepDurations/);
});

test('server download endpoint requires a short-lived signed URL', async () => {
  const endpoint = await read('api/jobs/[id]/apk.js');
  const jobs = await read('api/jobs/[id].js');
  assert.match(endpoint, /validateDownloadSignature/);
  assert.match(jobs, /downloadUrl: createDownloadUrl\(id\)/);
});

test('project type classification inspects package dependencies before choosing web JavaScript', async () => {
  const app = await read('assets/app.js');
  assert.match(app, /async function detectProjectType/);
  assert.match(app, /deps\['react-native'\] \|\| deps\.expo/);
  assert.match(app, /detectedType = await detectProjectType/);
});
