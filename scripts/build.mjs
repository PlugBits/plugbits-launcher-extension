import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

function validateManifest() {
  const manifestPath = path.join(srcDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (!manifest.name) {
    throw new Error('manifest.name missing');
  }

  if (!manifest.version) {
    throw new Error('manifest.version missing');
  }

  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('manifest.version must be semver (x.x.x)');
  }

  if (manifest.plugbits_dev_tools) {
    console.warn('[WARN] plugbits_dev_tools flag detected in src manifest');
  }

  console.log('[Build Version]', manifest.version);
}

const EXCLUDE_FILES = new Set([
  'dev-tools.js',
  'package.json',
  'package-lock.json',
  '.gitignore',
  'README.md',
  'content-overlay-controller.js'
]);

// Source files listed here are not real content scripts on their own — they are
// spliced into a host file at build time via a `// @@INCLUDE: <file>` marker, so
// content.js can stay split across files in src/ while shipping as one script.
const INCLUDE_TARGETS = [
  { host: 'content.js', include: 'content-overlay-controller.js' }
];

const EXCLUDE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'keys'
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    const dirName = path.basename(src);
    if (EXCLUDE_DIRS.has(dirName)) return;

    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(
        path.join(src, entry),
        path.join(dest, entry)
      );
    }
    return;
  }

  const fileName = path.basename(src);
  if (EXCLUDE_FILES.has(fileName)) return;

  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function inlineIncludes() {
  const bodyMarker = '// @@BODY_START\n';
  for (const { host, include } of INCLUDE_TARGETS) {
    const hostPath = path.join(distDir, host);
    const includePath = path.join(srcDir, include);
    const markerLine = new RegExp(`^[ \\t]*// @@INCLUDE: ${include.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm');
    const hostSource = fs.readFileSync(hostPath, 'utf8');
    if (!markerLine.test(hostSource)) {
      throw new Error(`${host} is missing the "// @@INCLUDE: ${include}" include marker`);
    }
    const includeSource = fs.readFileSync(includePath, 'utf8');
    const bodyStart = includeSource.indexOf(bodyMarker);
    if (bodyStart === -1) {
      throw new Error(`${include} is missing the "${bodyMarker.trim()}" marker`);
    }
    const body = includeSource.slice(bodyStart + bodyMarker.length).replace(/\n$/, '');
    fs.writeFileSync(hostPath, hostSource.replace(markerLine, body), 'utf8');
  }
}

function patchManifest() {
  const manifestPath = path.join(distDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  delete manifest.plugbits_dev_tools;

  if (Array.isArray(manifest.web_accessible_resources)) {
    manifest.web_accessible_resources = manifest.web_accessible_resources
      .map((item) => {
        if (!item || !Array.isArray(item.resources)) return item;
        return {
          ...item,
          resources: item.resources.filter((r) => r !== 'dev-tools.js')
        };
      })
      .filter((item) => Array.isArray(item.resources) && item.resources.length > 0);
  }

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
}

function scanDangerousCode(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      scanDangerousCode(full);
      continue;
    }

    if (!file.endsWith('.js')) continue;

    const code = fs.readFileSync(full, 'utf8');

    if (code.includes('eval(')) {
      console.warn('[WARN] eval() found in', file);
    }

    if (code.includes('new Function')) {
      console.warn('[WARN] new Function() found in', file);
    }
  }
}

if (!fs.existsSync(srcDir)) {
  console.error('src folder not found:', srcDir);
  process.exit(1);
}

validateManifest();
resetDir(distDir);
copyRecursive(srcDir, distDir);
inlineIncludes();
patchManifest();
scanDangerousCode(distDir);

console.log('[OK] build completed');
console.log('src :', srcDir);
console.log('dist:', distDir);