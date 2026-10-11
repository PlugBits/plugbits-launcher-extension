// 3.3.0: manifest.json の version 以外(特に permissions/host_permissions関連)が
// git HEAD と1バイトも変わっていないことを確認する(アンケート機能は新しい権限を一切使わない)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function readHeadManifest() {
  const text = execFileSync('git', ['show', 'HEAD:src/manifest.json'], { cwd: repoRoot, encoding: 'utf8' });
  return JSON.parse(text.replace(/^﻿/, ''));
}

function readWorkingManifest() {
  const text = fs.readFileSync(path.join(repoRoot, 'src', 'manifest.json'), 'utf8');
  return JSON.parse(text.replace(/^﻿/, ''));
}

export async function run({ check }) {
  const head = readHeadManifest();
  const current = readWorkingManifest();

  check('survey-manifest: version は 3.3.0 に上がっている', current.version === '3.3.0');

  const permissionKeys = [
    'permissions',
    'optional_permissions',
    'host_permissions',
    'optional_host_permissions',
    'content_scripts',
    'web_accessible_resources'
  ];
  for (const key of permissionKeys) {
    check(
      `survey-manifest: ${key} は HEAD と同一`,
      JSON.stringify(current[key]) === JSON.stringify(head[key])
    );
  }

  // version 以外の全キーも(アンケート機能の都合で)変わっていないことを確認する
  const headWithoutVersion = { ...head, version: undefined };
  const currentWithoutVersion = { ...current, version: undefined };
  check(
    'survey-manifest: version を除く全体が HEAD と同一',
    JSON.stringify(currentWithoutVersion) === JSON.stringify(headWithoutVersion)
  );
}
