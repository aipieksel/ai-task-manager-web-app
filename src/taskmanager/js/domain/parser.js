import { basename, normalizePath, stableId } from '../lib/utils.js';

export const PLAN_LIFECYCLES = Object.freeze([
  'draft',
  'pending',
  'approved',
  'in-progress',
  'review',
  'user-verification',
  'failed-user-verification',
  'completed',
  'archive',
  'parked',
  'blocker',
]);

const DEFAULT_STATUS_BY_LIFECYCLE = Object.freeze({
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  'in-progress': 'In Progress',
  review: 'Review',
  'user-verification': 'User Verification',
  'failed-user-verification': 'Requesting User Feedback',
  completed: 'Complete',
  archive: 'Archived',
  parked: 'Parked',
  blocker: 'Blocked',
});

function cleanInline(value = '') {
  return String(value)
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim();
}

function firstParagraph(value = '') {
  return String(value)
    .split(/\n\s*\n/)
    .map((part) => part
      .replace(/^[-*>#\s]+/gm, '')
      .replace(/^\*{0,2}At a Glance:\*{0,2}\s*/i, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .find((part) => part && !/^[A-Z][A-Za-z0-9 /&-]{0,48}$/.test(part)) || '';
}

function isPendingAnswer(value = '') {
  const normalized = cleanInline(value)
    .toLowerCase()
    .replace(/[.!?…。]+$/g, '')
    .trim();
  return !normalized || normalized === 'pending';
}

function stripFrontmatter(text = '') {
  return String(text).replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

function parseYamlFrontmatter(text = '') {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(String(text));
  const data = {};
  if (!match) return data;
  match[1].split(/\r?\n/).forEach((line) => {
    const item = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (!item) return;
    data[item[1].trim().toLowerCase()] = cleanInline(item[2].replace(/^['"]|['"]$/g, ''));
  });
  return data;
}

export function parseMarkdownTable(text = '') {
  const lines = String(text).split(/\r?\n/);
  const rows = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index].trim();
    const separator = lines[index + 1].trim();
    if (!header.startsWith('|') || !separator.startsWith('|') || !/\|\s*:?-{3,}/.test(separator)) continue;
    const headers = header.slice(1, -1).split('|').map((cell) => cell.trim());
    index += 2;
    while (index < lines.length && lines[index].trim().startsWith('|')) {
      const cells = lines[index].trim().slice(1, -1).split('|').map((cell) => cell.trim());
      if (cells.length === headers.length) {
        rows.push(Object.fromEntries(headers.map((name, cellIndex) => [name, cells[cellIndex] || ''])));
      }
      index += 1;
    }
    index -= 1;
  }
  return rows;
}

export function extractSections(text = '') {
  const lines = stripFrontmatter(text).split(/\r?\n/);
  const headings = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) headings.push({ level: match[1].length, title: match[2].trim(), line: index });
  });
  return headings.map((heading, index) => {
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const endLine = next ? next.line : lines.length;
    return {
      ...heading,
      id: stableId(heading.title, heading.line),
      startLine: heading.line,
      endLine,
      content: lines.slice(heading.line + 1, endLine).join('\n').trim(),
    };
  });
}

export function parseQuestions(text = '') {
  const lines = String(text).split(/\r?\n/);
  const starts = [];
  lines.forEach((line, index) => {
    const match = /^\s*-\s+\[([ xX])\]\s+\*\*(Q[\w.-]+):\s*(.+?)\*\*\s*$/.exec(line);
    if (match) starts.push({
      id: match[2],
      question: match[3].trim(),
      checked: match[1].toLowerCase() === 'x',
      startLine: index,
    });
  });

  return starts.map((start, startIndex) => {
    let endLine = starts[startIndex + 1]?.startLine ?? lines.length;
    for (let lineIndex = start.startLine + 1; lineIndex < endLine; lineIndex += 1) {
      if (/^#{1,3}\s+/.test(lines[lineIndex])) {
        endLine = lineIndex;
        break;
      }
    }
    const block = lines.slice(start.startLine, endLine);
    const question = {
      ...start,
      endLine,
      decision: '',
      why: '',
      recommendation: '',
      recommendationOption: '',
      answer: 'pending',
      answerSource: '',
      options: [],
      raw: block.join('\n'),
    };
    block.forEach((line, localIndex) => {
      const trimmed = line.trim();
      let match;
      if ((match = /^-\s+Decision:\s*(.+)$/i.exec(trimmed))) question.decision = match[1].trim();
      else if ((match = /^-\s+Why this matters:\s*(.+)$/i.exec(trimmed))) question.why = match[1].trim();
      else if ((match = /^-\s+Agent recommendation:\s*\(([a-z])\)\s*[—-]\s*(.+)$/i.exec(trimmed))) {
        question.recommendationOption = match[1].toLowerCase();
        question.recommendation = match[2].trim();
      } else if ((match = /^-\s+Answer:\s*(.*)$/i.exec(trimmed))) {
        question.answer = cleanInline(match[1]) || 'pending';
        question.answerLine = start.startLine + localIndex;
      } else if ((match = /^-\s+Answer source:\s*(.*)$/i.exec(trimmed))) {
        question.answerSource = cleanInline(match[1]);
        question.answerSourceLine = start.startLine + localIndex;
      } else if ((match = /^-\s+\(([a-z])\)\s+(.+)$/i.exec(trimmed))) {
        const optionText = match[2].trim();
        question.options.push({
          key: match[1].toLowerCase(),
          text: optionText.replace(/\s*\*\(recommended\)\*\s*$/i, '').trim(),
          recommended: /\*\(recommended\)\*/i.test(optionText),
        });
      }
    });
    if (!question.recommendationOption) {
      question.recommendationOption = question.options.find((option) => option.recommended)?.key || '';
    }
    question.answered = !isPendingAnswer(question.answer);
    return question;
  });
}

function parseMetadata(text = '') {
  const metadata = { ...parseYamlFrontmatter(text) };
  const lines = stripFrontmatter(text).split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
  let index = titleIndex >= 0 ? titleIndex + 1 : 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    const match = /^>\s*\*\*([^*]+):\*\*\s*(.+?)\s*$/.exec(trimmed);
    if (!match) break;
    metadata[match[1].trim().toLowerCase()] = cleanInline(match[2]);
    index += 1;
  }
  return metadata;
}

function lifecycleFromPath(path = '') {
  const normalized = normalizePath(path).toLowerCase();
  for (const state of PLAN_LIFECYCLES) {
    if (normalized.includes(`/planning/${state}/`)) return state;
  }
  return 'unknown';
}

function planFolderFromRelative(relativePath = '') {
  const normalized = normalizePath(relativePath);
  const pattern = new RegExp(`(^|/)planning/(${PLAN_LIFECYCLES.join('|')})/([^/]+)/plan\\.json$`, 'i');
  const match = pattern.exec(normalized);
  if (!match) return null;
  return {
    lifecycle: match[2].toLowerCase(),
    folderName: match[3],
    relativeFolder: normalized.replace(/\/plan\.json$/i, ''),
  };
}

function relativeDir(path = '') {
  const parts = normalizePath(path).split('/');
  parts.pop();
  return parts.join('/');
}

function fileAt(relativeFiles, folderRelative, filename) {
  return relativeFiles.get(normalizePath(`${folderRelative}/${filename}`));
}

function parseJsonManifest(file) {
  try {
    return JSON.parse(file.text || '{}');
  } catch (error) {
    return { schema: 'invalid-plan-json', parseError: error.message, sections: [] };
  }
}

function sectionHashBundle(files = []) {
  return files.map((file) => `${normalizePath(file.path)}:${file.hash || ''}`).sort().join('|');
}

function isResultOrHistoryHeading(title = '') {
  return /executor\s+(?:implementation|verification)\s+results|implementation\s+results|verification\s+results|correction\s+verification|review\s+evidence|r1\s+rejection|historical|superseded/i.test(String(title));
}

function isHistoricalChecklistLine(text = '') {
  return /\bNOT\s+APPROVED\b|\bImplementation\s+Rejected\b|\brejected\b.*\bsuperseded\b|\bhistorical\b.*\bsuperseded\b/i.test(String(text));
}

function extractPlanCheckboxes(text = '', path = '', options = {}) {
  const normalizedPath = normalizePath(path);
  const checkboxes = [];
  const liveOnly = Boolean(options.liveOnly);
  const sectionLayout = String(options.layout || '').toLowerCase();
  const sectionFile = String(options.sectionFile || basename(normalizedPath)).toLowerCase();
  const isLiveChecklistSection = sectionLayout === 'checklist' || /(?:implementation|testing|post-implementation|lifecycle-and-closeout).*\.md$/.test(sectionFile);
  if (liveOnly && !isLiveChecklistSection) return checkboxes;
  let currentHeading = '';
  String(text).split(/\r?\n/).forEach((line, lineIndex) => {
    const heading = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading) currentHeading = heading[1].trim();
    const match = /^\s*-\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line);
    if (!match) return;
    const itemText = cleanInline(match[2]);
    if (/^\*\*Q[\w.-]+:/.test(match[2])) return;
    if (isResultOrHistoryHeading(currentHeading)) return;
    if (isHistoricalChecklistLine(itemText)) return;
    checkboxes.push({
      checked: match[1].toLowerCase() === 'x',
      text: itemText,
      line: lineIndex,
      path: normalizedPath,
      heading: currentHeading,
    });
  });
  return checkboxes;
}

function extractCommentEvents(text = '', path = '') {
  const normalizedPath = normalizePath(path);
  const source = String(text || '');
  const headings = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const match = /^(#{2,4})\s+(.+?)\s*$/.exec(line.trim());
    if (match && /comment|feedback|reply|response|blocked|unblocked/i.test(match[2])) {
      headings.push({ level: match[1].length, title: cleanInline(match[2]), line: index });
    }
  });
  const lines = source.split(/\r?\n/);
  return headings.map((heading, index) => {
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const endLine = next ? next.line : lines.length;
    const body = lines.slice(heading.line + 1, endLine).join('\n').trim();
    const plain = body
      .replace(/^\s*-\s*(Source|Status|Comment|Feedback|Reply|Response):\s*/gim, '')
      .replace(/^[>*\s-]+/gm, '')
      .trim();
    const actor = /agent|automation|codex|executor|reviewer/i.test(`${heading.title}\n${body}`) && !/comment sent|feedback saved|user replied/i.test(heading.title)
      ? 'agent'
      : 'user';
    const timestamp = heading.title.match(/\d{4}-\d{2}-\d{2}T[0-9:.-]+Z?/)?.[0] || '';
    return {
      actor,
      title: heading.title,
      text: firstParagraph(plain) || plain.split(/\r?\n/).find(Boolean) || heading.title,
      line: heading.line,
      path: normalizedPath,
      timestamp,
    };
  }).filter((event) => event.text);
}

function normalizePlanScoreValue(score, fallbackText = '') {
  if (typeof score === 'number') return `${score}/10`;
  if (typeof score === 'string') return score.trim();
  if (score && typeof score === 'object') {
    const value = score.value ?? score.score ?? score.rating;
    if (value !== undefined && value !== null && String(value).trim()) {
      const suffix = score.provisional ? ' provisional' : '';
      return `${String(value).trim()}/10${suffix}`;
    }
  }
  const match = /(?:Plan\s+Score|Plan\s+score|Score):\s*\**`?(\d+(?:\.\d+)?\s*\/\s*10)\**`?/i.exec(fallbackText);
  return match?.[1]?.replace(/\s+/g, '') || '';
}

export function parsePlan(text, path, project) {
  const normalizedPath = normalizePath(path);
  const sections = extractSections(text);
  const metadata = parseMetadata(text);
  const titleMatch = /^#\s+(?:Plan:\s*)?(.+?)\s*$/m.exec(stripFrontmatter(text));
  const title = titleMatch?.[1]?.trim() || basename(normalizedPath).replace(/\.md$/i, '').replaceAll('-', ' ');
  const questions = parseQuestions(text);
  const checkboxes = extractPlanCheckboxes(text, normalizedPath);
  const commentEvents = extractCommentEvents(text, normalizedPath);
  const scoreValue = metadata['plan score'] || metadata.planscore || /(?:Provisional\s+)?score:\s*([^\n]+)/i.exec(text)?.[1]?.trim() || '';
  const targetSection = sections.find((section) => /^Target State$/i.test(section.title));
  const requestSection = sections.find((section) => /^Original User Request$/i.test(section.title));
  const verificationSections = sections.filter((section) => /verification|testing|untested reconciliation|closeout review/i.test(section.title));
  const closeoutSection = sections.find((section) => /closeout review/i.test(section.title));
  const closeoutStatus = /(?:final status|status):\s*`?(Complete|Partial|Keep in progress)`?/i.exec(closeoutSection?.content || '')?.[1] || '';
  const lifecycle = lifecycleFromPath(normalizedPath);
  const status = metadata.status || DEFAULT_STATUS_BY_LIFECYCLE[lifecycle] || 'Unknown';
  return {
    id: stableId(project.id, normalizedPath),
    planKind: 'legacy-file',
    projectId: project.id,
    projectName: project.name,
    path: normalizedPath,
    planFilePath: normalizedPath,
    filename: basename(normalizedPath),
    title,
    description: firstParagraph(targetSection?.content || requestSection?.content || ''),
    status,
    lifecycle,
    metadata,
    score: scoreValue,
    riskLevel: metadata['risk level'] || metadata.risk || '',
    sections,
    planSections: [],
    questions,
    checkboxes,
    commentEvents,
    verificationSections,
    closeoutStatus,
    completedSteps: checkboxes.filter((item) => item.checked).length,
    totalSteps: checkboxes.length,
    raw: text,
  };
}

export function parsePlanFolder(manifestFile, relativeFiles, project) {
  const manifestMeta = planFolderFromRelative(manifestFile.relativeToTaskRoot || manifestFile.path);
  const folderRelative = manifestMeta?.relativeFolder || relativeDir(manifestFile.relativeToTaskRoot || manifestFile.path);
  const folderPath = relativeDir(manifestFile.path);
  const manifest = parseJsonManifest(manifestFile);
  const configuredSections = Array.isArray(manifest.sections)
    ? manifest.sections
    : (Array.isArray(manifest.canonicalFiles)
      ? manifest.canonicalFiles.map((file, index) => ({
        order: index + 1,
        file,
        sectionId: String(file).replace(/\.md$/i, ''),
        title: basename(String(file)).replace(/^\d+-/, '').replace(/-/g, ' ').replace(/\.md$/i, ''),
        navLabel: basename(String(file)).replace(/^\d+-/, '').replace(/-/g, ' ').replace(/\.md$/i, ''),
        layout: 'article',
        appendOnly: /12-comments\.md$/i.test(String(file)),
      }))
      : []);
  const orderedSections = configuredSections
    .filter((section) => section?.file)
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const sectionFiles = orderedSections
    .map((section) => ({ section, file: fileAt(relativeFiles, folderRelative, section.file) }))
    .filter((item) => item.file);
  const fallbackSectionFiles = !sectionFiles.length
    ? [...relativeFiles.values()].filter((file) => normalizePath(file.relativeToTaskRoot || '').startsWith(`${folderRelative}/`) && /\.md$/i.test(file.path))
    : [];
  const allSectionFiles = sectionFiles.length
    ? sectionFiles
    : fallbackSectionFiles.map((file, index) => ({ section: { order: index + 1, file: basename(file.path), title: basename(file.path).replace(/\.md$/i, ''), navLabel: basename(file.path), layout: 'article' }, file }));
  const raw = allSectionFiles.map(({ section, file }) => `\n\n<!-- ${section.file} -->\n${file.text || ''}`).join('').trim();
  const sections = allSectionFiles.flatMap(({ section, file }) => {
    const parsed = extractSections(file.text || '');
    if (parsed.length) {
      return parsed.map((parsedSection) => ({
        ...parsedSection,
        file: file.path,
        sourcePath: file.path,
        sectionFile: section.file,
        sectionId: section.sectionId || section.section_id || section.file,
        navLabel: section.navLabel || section.nav_label || section.title || section.file,
        layout: section.layout || 'article',
        order: Number(section.order || 0),
      }));
    }
    return [{
      level: 2,
      title: section.title || section.file,
      line: 0,
      id: section.sectionId || section.file,
      startLine: 0,
      endLine: 0,
      content: stripFrontmatter(file.text || ''),
      file: file.path,
      sourcePath: file.path,
      sectionFile: section.file,
      sectionId: section.sectionId || section.section_id || section.file,
      navLabel: section.navLabel || section.nav_label || section.title || section.file,
      layout: section.layout || 'article',
      order: Number(section.order || 0),
    }];
  });
  const questionItem = allSectionFiles.find(({ section }) => /questions-and-decisions/i.test(section.file || section.sectionId || '')) || allSectionFiles.find(({ file }) => /05-questions-and-decisions\.md$/i.test(file.path));
  const commentsItem = allSectionFiles.find(({ section }) => /comments/i.test(section.file || section.sectionId || '')) || allSectionFiles.find(({ file }) => /12-comments\.md$/i.test(file.path));
  const questions = parseQuestions(questionItem?.file?.text || raw).map((question) => ({ ...question, sourcePath: questionItem?.file?.path || manifestFile.path }));
  const checkboxes = allSectionFiles.flatMap(({ section, file }) => extractPlanCheckboxes(file.text || '', file.path, { liveOnly: true, layout: section.layout, sectionFile: section.file || basename(file.path) }));
  const commentEvents = commentsItem?.file
    ? extractCommentEvents(commentsItem.file.text || '', commentsItem.file.path)
    : extractCommentEvents(raw, manifestFile.path);
  const lifecycle = (manifest.lifecycle || manifestMeta?.lifecycle || lifecycleFromPath(manifestFile.path) || '').toLowerCase() || 'unknown';
  const status = manifest.status || DEFAULT_STATUS_BY_LIFECYCLE[lifecycle] || 'Unknown';
  const title = manifest.title || sections.find((section) => section.level === 1)?.title || manifest.folderName || basename(folderPath).replaceAll('-', ' ');
  const score = normalizePlanScoreValue(manifest.planScore ?? manifest.plan_score, raw);
  const closeoutText = allSectionFiles.find(({ section, file }) => /lifecycle-and-closeout|closeout/i.test(section.file || file.path))?.file?.text || raw;
  const closeoutStatus = /(?:final status|status):\s*`?(Complete|Partial|Keep in progress)`?/i.exec(closeoutText)?.[1] || '';
  const verificationSections = sections.filter((section) => /verification|testing|browser|review|evidence|closeout/i.test(`${section.title} ${section.sectionFile}`));
  const filesForHash = [manifestFile, ...allSectionFiles.map((item) => item.file)];
  return {
    id: stableId(project.id, folderPath),
    planKind: 'folder',
    projectId: project.id,
    projectName: project.name,
    path: folderPath,
    folderPath,
    manifestPath: manifestFile.path,
    planFilePath: manifestFile.path,
    questionPath: questionItem?.file?.path || manifestFile.path,
    commentsPath: commentsItem?.file?.path || manifestFile.path,
    filename: basename(folderPath),
    folderName: basename(folderPath),
    title,
    description: firstParagraph(sections.find((section) => /current and target|target state|original scope/i.test(section.title))?.content || raw),
    status,
    lifecycle,
    planningState: manifest.planningState || manifest.planning_state || '',
    metadata: { ...manifest, status, lifecycle },
    manifest,
    score,
    riskLevel: manifest.riskLevel || manifest.risk_level || '',
    sections,
    planSections: allSectionFiles.map(({ section, file }) => ({
      order: Number(section.order || 0),
      file: section.file || basename(file.path),
      path: file.path,
      sectionId: section.sectionId || section.section_id || section.file || basename(file.path),
      title: section.title || basename(file.path),
      navLabel: section.navLabel || section.nav_label || section.title || basename(file.path),
      layout: section.layout || 'article',
      appendOnly: Boolean(section.appendOnly || section.append_only),
      text: file.text || '',
      summary: parseYamlFrontmatter(file.text || '').summary || '',
      hash: file.hash || '',
    })),
    questions,
    checkboxes,
    commentEvents,
    verificationSections,
    closeoutStatus,
    completedSteps: checkboxes.filter((item) => item.checked).length,
    totalSteps: checkboxes.length,
    raw,
    hash: manifestFile.hash || '',
    hashBundle: sectionHashBundle(filesForHash),
    fileHashes: Object.fromEntries(filesForHash.map((file) => [normalizePath(file.path), file.hash || ''])),
    createdAt: Math.min(...filesForHash.map((file) => Number(file.createdAt || file.lastModified || Date.now()))),
    lastModified: Math.max(...filesForHash.map((file) => Number(file.lastModified || 0))),
    size: filesForHash.reduce((sum, file) => sum + Number(file.size || 0), 0),
  };
}

export function parseTodo(text, path, project) {
  const lines = String(text).replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const tasks = [];
  let current = null;
  lines.forEach((line, lineIndex) => {
    const taskMatch = /^\s*-\s+\[([ xX])\]\s+\*\*(.+?)\*\*\s*$/.exec(line);
    const tableMatch = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\[[^\]]+\]\(([^)]+)\)|`?([^|`]+)`?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(line);
    if (taskMatch) {
      current = {
        id: stableId(project.id, path, lineIndex, taskMatch[2]),
        projectId: project.id,
        projectName: project.name,
        title: taskMatch[2].trim(),
        complete: taskMatch[1].toLowerCase() === 'x',
        fields: {},
        path: normalizePath(path),
        sourceLine: lineIndex,
      };
      tasks.push(current);
      return;
    }
    if (tableMatch && !/^id$/i.test(tableMatch[1].trim()) && !/^-+$/.test(tableMatch[1].trim())) {
      const planRef = tableMatch[5] || tableMatch[6] || '';
      tasks.push({
        id: stableId(project.id, path, lineIndex, tableMatch[1], tableMatch[2]),
        projectId: project.id,
        projectName: project.name,
        title: tableMatch[2].trim(),
        complete: /complete/i.test(tableMatch[3]),
        fields: {
          id: tableMatch[1].trim(),
          status: tableMatch[3].trim(),
          plan: planRef.trim(),
          owner: tableMatch[7].trim(),
          updated: tableMatch[8].trim(),
          scope: tableMatch[9].trim(),
        },
        path: normalizePath(path),
        sourceLine: lineIndex,
      });
      current = null;
      return;
    }
    if (!current) return;
    const fieldMatch = /^\s{2,}-\s+([^:]+):\s*(.*?)\s*$/.exec(line);
    if (fieldMatch) current.fields[fieldMatch[1].trim().toLowerCase()] = cleanInline(fieldMatch[2]);
  });
  return tasks.map((task) => ({
    ...task,
    category: task.fields.category || '',
    type: task.fields.type || 'Task',
    status: task.fields.status || (task.complete ? 'Complete' : 'Active'),
    planPath: normalizePath((task.fields.plan || '').split('|')[0].trim()),
    score: task.fields['plan score'] || '',
    verificationMethod: task.fields['verification method'] || '',
    description: task.fields.scope || task.fields.notes || '',
    closeout: task.fields.closeout || '',
    blocker: task.fields.blocker || 'none',
  }));
}

export function parseDailyLog(text, path, project) {
  return parseMarkdownTable(text)
    .filter((row) => row.Title)
    .map((row, index) => ({
      id: stableId(project.id, path, index, row.Title),
      projectId: project.id,
      projectName: project.name,
      path: normalizePath(path),
      title: row.Title,
      description: row.Description || '',
      startDate: row['Start Date'] || '',
      endDate: row['End Date'] || '',
      category: row.Category || '',
      type: row.Type || 'Task',
      status: 'Complete',
    }));
}

function parseLessonMarkdown(text, path, project, layer) {
  const sections = extractSections(text).filter((section) => section.level >= 2);
  if (!sections.length && String(text).trim()) {
    return [{
      id: stableId(project.id, path), projectId: project.id, projectName: project.name,
      path: normalizePath(path), layer, title: basename(path), content: String(text).trim(),
    }];
  }
  return sections.map((section) => ({
    id: stableId(project.id, path, section.title),
    projectId: project.id,
    projectName: project.name,
    path: normalizePath(path),
    layer,
    title: section.title,
    content: section.content,
  }));
}

export function parseLessons(files, project) {
  const lessons = [];
  const active = files.get('lessons-active.md');
  const archive = files.get('lessons.md');
  if (active) lessons.push(...parseLessonMarkdown(active.text, active.path, project, 'active'));
  if (archive) lessons.push(...parseLessonMarkdown(archive.text, archive.path, project, 'archive'));
  const indexFile = files.get('lessons-index.json');
  if (indexFile) {
    try {
      const parsed = JSON.parse(indexFile.text);
      (parsed.entries || []).forEach((entry) => lessons.push({
        id: stableId(project.id, indexFile.path, entry.id || entry.title),
        projectId: project.id,
        projectName: project.name,
        path: indexFile.path,
        layer: 'index',
        title: entry.title || entry.id || 'Indexed lesson',
        content: '',
        ...entry,
      }));
    } catch (error) {
      lessons.push({
        id: stableId(project.id, indexFile.path, 'parse-error'),
        projectId: project.id,
        projectName: project.name,
        path: indexFile.path,
        layer: 'index-error',
        title: 'Invalid lessons index',
        content: error.message,
      });
    }
  }
  return lessons;
}

export function parseObservations(files, project) {
  const observations = [];
  for (const file of files.values()) {
    const lower = file.path.toLowerCase();
    if (!lower.includes('agent-observations/') && !lower.endsWith('/observations.md')) continue;
    const type = lower.includes('/critical.md') ? 'critical'
      : lower.includes('/recommendations.md') ? 'recommendation'
        : lower.includes('/anomalies.md') ? 'anomaly'
          : lower.includes('/closed/') ? 'closed' : 'other';
    parseMarkdownTable(file.text).forEach((row, index) => observations.push({
      id: stableId(project.id, file.path, index, row.Observation || row.Area || row.Date),
      projectId: project.id,
      projectName: project.name,
      path: file.path,
      type,
      date: row.Date || '',
      source: row.Source || row.Area || '',
      observation: row.Observation || '',
      impact: row.Impact || row.Severity || '',
      action: row.Action || row['Follow-up'] || '',
      status: row.Status || '',
    }));
  }
  return observations;
}

function normalizeComparablePath(path = '') {
  return normalizePath(path).replace(/^\.\//, '').replace(/\/$/, '').toLowerCase();
}

function planReferenceMatches(todoPlanPath, plan) {
  const todoPath = normalizeComparablePath(todoPlanPath);
  if (!todoPath) return false;
  const candidates = [plan.path, plan.folderPath, plan.manifestPath, plan.planFilePath, plan.filename, plan.folderName]
    .filter(Boolean)
    .map(normalizeComparablePath);
  return candidates.some((candidate) => candidate === todoPath || candidate.endsWith(`/${todoPath}`) || todoPath.endsWith(`/${candidate}`) || basename(candidate) === basename(todoPath));
}

function isSelfTestFile(file) {
  const relative = normalizePath(file.relativeToTaskRoot || file.path).toLowerCase();
  const generatedFixtureFolder = 'task-system-' + 'tests';
  return relative.includes(`/${generatedFixtureFolder}/`) || relative.startsWith(`${generatedFixtureFolder}/`);
}

function completionEvidenceForPlan(plan) {
  const raw = String(plan.raw || '');
  const compact = raw.replace(/\s+/g, ' ');
  const evidence = {
    r1ImplementationApproved: /\bImplementation Approved\b/i.test(compact) || /\bR1\b.{0,80}\bApproved\b/i.test(compact),
    finalNotTestedReconciled: /\bFinal Not Tested\b/i.test(compact) && !/\bFinal Not Tested\b.{0,80}\b(?:pending|not run|tbd|required self-testable|unresolved)\b/i.test(compact),
    finalVerificationPass: /\bFinal verification status:\s*PASS\b/i.test(compact) || /\bExecutor verification:\s*PASS\b/i.test(compact),
    finalCloseoutApproved: /\bFINAL CLOSEOUT REVIEW APPROVED\b/i.test(compact) || /\bFinal Closeout Approved\b/i.test(compact),
    closeoutComplete: /^complete$/i.test(plan.closeoutStatus || ''),
  };
  const blockers = [];
  if (!evidence.r1ImplementationApproved) blockers.push('R1 implementation approval is missing');
  if (!evidence.finalNotTestedReconciled) blockers.push('Final Not Tested reconciliation is missing or unresolved');
  if (!evidence.finalVerificationPass) blockers.push('Final verification status PASS is missing');
  if (!evidence.finalCloseoutApproved) blockers.push('R2/final closeout approval token is missing');
  if (!evidence.closeoutComplete) blockers.push('Closeout Review final status is not Complete');
  return { evidence, blockers };
}

export function buildProjectDomain(project, fileList) {
  const files = new Map(fileList.map((file) => [normalizePath(file.path), file]));
  const relativeFiles = new Map();
  fileList.forEach((file) => {
    const relative = normalizePath(file.relativeToTaskRoot || file.path);
    relativeFiles.set(relative, file);
  });

  const manifestFiles = fileList.filter((file) => !isSelfTestFile(file) && planFolderFromRelative(file.relativeToTaskRoot || file.path));
  const folderPlans = manifestFiles.map((file) => parsePlanFolder(file, relativeFiles, project));
  const folderPlanPaths = new Set(folderPlans.flatMap((plan) => [plan.folderPath, plan.manifestPath, ...(plan.planSections || []).map((section) => section.path)].filter(Boolean).map(normalizePath)));
  const lifecyclePattern = PLAN_LIFECYCLES.join('|');
  const legacyPlanPattern = new RegExp(`(^|/)planning/(${lifecyclePattern})/[^/]+\\.md$`, 'i');
  const planFiles = fileList.filter((file) => !isSelfTestFile(file) && legacyPlanPattern.test(file.relativeToTaskRoot || file.path) && !folderPlanPaths.has(normalizePath(file.path)));
  const legacyPlans = planFiles.map((file) => ({ ...parsePlan(file.text, file.path, project), createdAt: file.createdAt || file.lastModified || null, lastModified: file.lastModified, size: file.size, hash: file.hash }));
  const plans = [...folderPlans, ...legacyPlans];
  const todoFile = fileList.find((file) => /(^|\/)todo\.md$/i.test(file.relativeToTaskRoot || file.path));
  const todoTasks = todoFile ? parseTodo(todoFile.text, todoFile.path, project) : [];

  const tasks = plans.map((plan) => {
    const matchingTodo = todoTasks.find((todo) => planReferenceMatches(todo.planPath, plan))
      || todoTasks.find((todo) => todo.title.toLowerCase() === plan.title.toLowerCase());
    const unanswered = plan.questions.filter((question) => !question.answered).length;
    const completion = completionEvidenceForPlan(plan);
    return {
      ...plan,
      source: 'plan',
      todo: matchingTodo || null,
      todoStatus: matchingTodo?.status || '',
      status: plan.status || matchingTodo?.status || 'Unknown',
      description: matchingTodo?.description || plan.description,
      category: matchingTodo?.category || '',
      type: matchingTodo?.type || 'Task',
      todoCloseout: matchingTodo?.closeout || '',
      closeout: plan.closeoutStatus || matchingTodo?.closeout || '',
      blocker: matchingTodo?.blocker || 'none',
      unansweredQuestions: unanswered,
      questionCount: plan.questions.length,
      completionEvidence: completion.evidence,
      completionBlockers: completion.blockers,
    };
  });

  todoTasks.filter((todo) => !tasks.some((task) => task.todo?.id === todo.id)).forEach((todo) => {
    tasks.push({
      ...todo,
      source: 'todo',
      lifecycle: todo.complete ? 'completed' : 'active',
      questions: [],
      sections: [],
      planSections: [],
      checkboxes: [],
      completedSteps: 0,
      totalSteps: 0,
      unansweredQuestions: 0,
      questionCount: 0,
      raw: todoFile?.text || '',
      createdAt: todoFile?.createdAt || todoFile?.lastModified || null,
      lastModified: todoFile?.lastModified || null,
      size: todoFile?.size || 0,
      hash: todoFile?.hash || '',
    });
  });

  const questions = tasks.flatMap((task) => (task.questions || []).map((question, index) => ({
    ...question,
    uid: stableId(task.id, question.id, question.startLine ?? index),
    taskId: task.id,
    taskTitle: task.title,
    planPath: question.sourcePath || task.questionPath || task.path,
    planFolderPath: task.folderPath || '',
    projectId: task.projectId,
    projectName: task.projectName,
    fileHash: fileList.find((file) => normalizePath(file.path) === normalizePath(question.sourcePath || task.questionPath || task.path))?.hash || '',
  })));

  const verifications = tasks.filter((task) => task.source === 'plan').map((task) => ({
    id: stableId(task.id, 'verification'),
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.projectId,
    projectName: task.projectName,
    path: task.path,
    sections: task.verificationSections || [],
    items: (task.checkboxes || []).filter((item) => /verify|test|check|evidence|screenshot|lint|build|scenario|external verification/i.test(item.text)),
    status: task.closeout || task.status,
  }));

  const completed = fileList
    .filter((file) => /(^|\/)logs\/\d{4}-\d{2}-\d{2}\.md$/i.test(file.relativeToTaskRoot || file.path))
    .flatMap((file) => parseDailyLog(file.text, file.path, project));

  const lessons = parseLessons(relativeFiles, project);
  const observations = parseObservations(files, project);
  const queue = tasks.filter((task) => !/complete|completed|closed|archive|archived/i.test(`${task.status} ${task.lifecycle}`));

  return {
    project,
    files: fileList,
    tasks,
    queue,
    questions,
    verifications,
    lessons,
    observations,
    completed,
    scannedAt: Date.now(),
  };
}
