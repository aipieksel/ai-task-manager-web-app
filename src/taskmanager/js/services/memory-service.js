const MEM0_BASE = './api/memory';

async function mem0Fetch(path, options = {}) {
  const response = await fetch(new URL(path, location.href).href, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Mem0 request failed: HTTP ${response.status}`);
  }
  return payload;
}

/**
 * Store a memory for a specific project/user.
 * @param {string} projectId - The project scope for this memory
 * @param {string} messages - The text content to remember
 * @param {Object} metadata - Arbitrary structured metadata
 */
export async function addMemory(projectId, messages, metadata = {}) {
  return mem0Fetch(`${MEM0_BASE}/add`, {
    method: 'POST',
    body: JSON.stringify({
      messages,
      user_id: projectId,
      metadata: { ...metadata, app: 'task-manager' },
      agent_id: 'task-manager',
    }),
  });
}

/**
 * Semantic search across stored memories.
 * @param {string} query - Natural language search
 * @param {string} [projectId] - Scope to a project, or omit for cross-project
 * @param {number} [limit=10] - Max results
 */
export async function searchMemory(query, projectId = null, limit = 10) {
  return mem0Fetch(`${MEM0_BASE}/search`, {
    method: 'POST',
    body: JSON.stringify({
      query,
      user_id: projectId || 'default',
      limit,
    }),
  });
}

/**
 * Get all memories for a project (or all projects if omitted).
 */
export async function listMemories(projectId = null, limit = 50) {
  const params = new URLSearchParams();
  if (projectId) params.set('user_id', projectId);
  params.set('limit', String(limit));
  return mem0Fetch(`${MEM0_BASE}/list?${params}`);
}

/**
 * Delete a specific memory by ID.
 */
export async function deleteMemory(memoryId) {
  return mem0Fetch(`${MEM0_BASE}/${memoryId}`, { method: 'DELETE' });
}

/**
 * Get cross-project insights for a given task or topic.
 * Searches all project memories for relevant past decisions and lessons.
 */
export async function getCrossProjectInsights(topic, limit = 5) {
  const results = await searchMemory(topic, null, limit);
  return (results.results || []).map((item) => ({
    id: item.id,
    memory: item.memory,
    score: item.score,
    projectId: item.user_id,
    metadata: item.metadata || {},
    createdAt: item.created_at,
  }));
}
