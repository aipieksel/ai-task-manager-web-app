function apiUrl(path) {
  return new URL(path, location.href).href;
}

let runtimeServerProbe;
async function ensureRuntimeServer() {
  if (!runtimeServerProbe) {
    runtimeServerProbe = fetch(apiUrl('./data/runtime/projects.json'), { method: 'HEAD', cache: 'no-store' })
      .then((response) => {
        if (response.headers.get('X-TaskManager-Runtime-Config-Write') !== '1') {
          throw new Error('Runtime automation API unavailable. Start tooling/scripts/serve-runtime.py or Electron to use Agent Control Center live controls.');
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
    throw new Error(payload.error || `Automation request failed: HTTP ${response.status}`);
  }
  return payload;
}

export async function loadAutomationSummary() {
  return requestJson('./api/automation/summary');
}

export async function submitAutomationAction(action, payload = {}) {
  return requestJson('./api/automation/action', {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  });
}
