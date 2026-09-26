import { normalizePath } from '../lib/utils.js';

function apiUrl(path) {
  return new URL(path, location.href).href;
}

function isAbsoluteFilesystemPath(path = '') {
  return /^\/[^/]/.test(String(path));
}

export function isServerBackedProject(project = {}) {
  return Boolean(project.serverBacked || isAbsoluteFilesystemPath(project.rootLabel || project.rootPath || ''));
}

function projectPayload(project = {}) {
  return {
    id: project.id,
    name: project.name,
    rootLabel: project.rootLabel || project.rootPath || project.name,
    explicitTaskPath: normalizePath(project.explicitTaskPath || project.taskRootPath || ''),
    autoApprovePending: Boolean(project.autoApprovePending),
    includeInAllQueue: project.includeInAllQueue !== false,
  };
}

let runtimeServerProbe;
async function ensureRuntimeServer() {
  if (!runtimeServerProbe) {
    runtimeServerProbe = fetch(apiUrl('./data/runtime/projects.json'), { method: 'HEAD', cache: 'no-store' })
      .then((response) => {
        if (response.headers.get('X-TaskManager-Runtime-Config-Write') !== '1') {
          throw new Error('Runtime filesystem API unavailable. Start tooling/scripts/serve-runtime.py instead of a plain static server.');
        }
        return true;
      });
  }
  return runtimeServerProbe;
}

async function requestJson(path, options = {}) {
  await ensureRuntimeServer();
  const response = await fetch(apiUrl(path), {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Runtime server request failed: HTTP ${response.status}`);
  }
  return payload;
}

export async function scanServerProject(project, settings) {
  return requestJson('./api/projects/scan', {
    method: 'POST',
    body: JSON.stringify({ project: projectPayload(project), settings }),
  });
}

export async function bootstrapServerProject(project, { instruction, expectedRevision = '', dryRun = false } = {}) {
  return requestJson('./api/projects/bootstrap', {
    method: 'POST',
    body: JSON.stringify({
      project: projectPayload(project),
      instruction: String(instruction || ''),
      expectedRevision: String(expectedRevision || ''),
      dryRun: Boolean(dryRun),
    }),
  });
}

export async function readServerTextFile(project, path) {
  const payload = await requestJson('./api/files/read', {
    method: 'POST',
    body: JSON.stringify({
      project: projectPayload(project),
      path: normalizePath(path),
      taskRootPath: normalizePath(project.taskRootPath || project.explicitTaskPath || ''),
    }),
  });
  return payload.file;
}

export async function writeServerTextFile(project, path, text, expectedHash = '') {
  const payload = await requestJson('./api/files/text', {
    method: 'PUT',
    body: JSON.stringify({
      project: projectPayload(project),
      path: normalizePath(path),
      taskRootPath: normalizePath(project.taskRootPath || project.explicitTaskPath || ''),
      text: String(text),
      expectedHash,
    }),
  });
  return payload.file;
}

export async function copyVerifyDeleteServer(project, sourcePath, destinationPath, destinationText, expectedSourceHash = '') {
  const payload = await requestJson('./api/files/copy-verify-delete', {
    method: 'POST',
    body: JSON.stringify({
      project: projectPayload(project),
      taskRootPath: normalizePath(project.taskRootPath || project.explicitTaskPath || ''),
      sourcePath: normalizePath(sourcePath),
      destinationPath: normalizePath(destinationPath),
      destinationText: String(destinationText),
      expectedSourceHash,
    }),
  });
  return { ...payload.file, sourceHash: payload.sourceHash };
}

export async function copyVerifyDeleteFolderServer(project, sourcePath, destinationPath, updates = {}, expectedManifestHash = '') {
  const payload = await requestJson('./api/folders/copy-verify-delete', {
    method: 'POST',
    body: JSON.stringify({
      project: projectPayload(project),
      taskRootPath: normalizePath(project.taskRootPath || project.explicitTaskPath || ''),
      sourcePath: normalizePath(sourcePath),
      destinationPath: normalizePath(destinationPath),
      updates,
      expectedManifestHash,
    }),
  });
  return {
    folderPath: normalizePath(payload.folderPath || destinationPath),
    manifest: payload.manifest,
    sourceManifestHash: payload.sourceManifestHash || '',
    updatedFiles: payload.updatedFiles || [],
  };
}

export async function selectProjectFolder({ dryRun = false } = {}) {
  return requestJson('./api/system/select-directory', {
    method: 'POST',
    body: JSON.stringify({ dryRun }),
  });
}
