import { parseQuestions } from './parser.js';

function normalizeAnswer(option, customText = '') {
  const key = String(option?.key || '').toLowerCase();
  if (key && /^other\b/i.test(option?.text || '')) return customText.trim();
  return option?.text?.trim() || customText.trim();
}

export function applyQuestionAnswer(text, questionId, option, customText = '', source = 'TaskManager interactive choice') {
  const lines = String(text).split(/\r?\n/);
  const question = parseQuestions(text).find((candidate) => candidate.id.toLowerCase() === String(questionId).toLowerCase());
  if (!question) throw new Error(`Question ${questionId} was not found in the plan.`);
  const answer = normalizeAnswer(option, customText);
  if (!answer) throw new Error('Choose an answer or enter a custom answer.');

  lines[question.startLine] = lines[question.startLine].replace(/\[\s\]/, '[x]');
  let insertionPoint = question.endLine;
  if (Number.isInteger(question.answerLine)) {
    const prefix = lines[question.answerLine].match(/^\s*/)?.[0] || '  ';
    lines[question.answerLine] = `${prefix}- Answer: ${answer}`;
    insertionPoint = question.answerLine + 1;
  } else {
    const recommendationLine = lines.slice(question.startLine, question.endLine)
      .findIndex((line) => /^\s*-\s+Agent recommendation:/i.test(line));
    insertionPoint = recommendationLine >= 0 ? question.startLine + recommendationLine + 1 : question.endLine;
    lines.splice(insertionPoint, 0, `  - Answer: ${answer}`);
  }

  const refreshed = parseQuestions(lines.join('\n')).find((candidate) => candidate.id.toLowerCase() === String(questionId).toLowerCase());
  if (Number.isInteger(refreshed?.answerSourceLine)) {
    const prefix = lines[refreshed.answerSourceLine].match(/^\s*/)?.[0] || '  ';
    lines[refreshed.answerSourceLine] = `${prefix}- Answer source: ${source}`;
  } else {
    const answerLine = refreshed?.answerLine ?? insertionPoint;
    lines.splice(answerLine + 1, 0, `  - Answer source: ${source}`);
  }
  return { text: lines.join('\n'), answer };
}

export function applyRecommendedAnswers(text, questionIds = null) {
  let nextText = String(text);
  const applied = [];
  const initial = parseQuestions(nextText);
  const allowed = questionIds ? new Set(questionIds.map((id) => String(id).toLowerCase())) : null;
  initial.forEach((question) => {
    if (question.answered || (allowed && !allowed.has(question.id.toLowerCase()))) return;
    const recommended = question.options.find((option) => option.recommended)
      || question.options.find((option) => option.key === question.recommendationOption)
      || question.options[0];
    if (!recommended) return;
    const result = applyQuestionAnswer(nextText, question.id, recommended);
    nextText = result.text;
    applied.push({ id: question.id, answer: result.answer });
  });
  return { text: nextText, applied };
}

export function updatePlanMetadata(text, key, value) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^>\\s*\\*\\*${escapedKey}:\\*\\*\\s*.*$`, 'mi');
  if (pattern.test(text)) return text.replace(pattern, `> **${key}:** ${value}`);
  const lines = String(text).split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
  lines.splice(titleIndex >= 0 ? titleIndex + 1 : 0, 0, '', `> **${key}:** ${value}`);
  return lines.join('\n');
}

function todoTitleAt(line = '') {
  return /^\s*-\s+\[[ xX]\]\s+\*\*(.+?)\*\*\s*$/.exec(line)?.[1]?.trim() || '';
}

function isTableRow(line = '') {
  return /^\s*\|.*\|\s*$/.test(line);
}

function splitTableRow(line = '') {
  const trimmed = String(line || '').trim();
  if (!isTableRow(trimmed)) return [];
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

function formatTableRow(cells = []) {
  return `| ${cells.join(' | ')} |`;
}

function tableHeadersForRow(lines, rowIndex) {
  for (let index = rowIndex - 1; index >= 0; index -= 1) {
    const cells = splitTableRow(lines[index]);
    if (!cells.length) continue;
    if (cells.some((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    return cells;
  }
  return [];
}

function updateTodoTableRow(lines, todoTask, fields) {
  const candidateLine = Number.isInteger(todoTask?.sourceLine) ? lines[todoTask.sourceLine] : '';
  const rowIndex = isTableRow(candidateLine) ? todoTask.sourceLine : lines.findIndex((line) => {
    const cells = splitTableRow(line);
    return cells.length && cells.some((cell) => cell.replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1').replace(/`/g, '').trim() === todoTask?.planPath);
  });
  if (rowIndex < 0 || !isTableRow(lines[rowIndex])) return false;
  const headers = tableHeadersForRow(lines, rowIndex).map((header) => header.toLowerCase());
  const cells = splitTableRow(lines[rowIndex]);
  const updates = new Map(Object.entries(fields).map(([key, value]) => [key.toLowerCase(), value]));
  headers.forEach((header, index) => {
    if (updates.has(header) && index < cells.length) cells[index] = updates.get(header);
  });
  lines[rowIndex] = formatTableRow(cells);
  return true;
}

export function updateTodoTaskFields(text, todoTask, fields) {
  const lines = String(text).split(/\r?\n/);
  if (updateTodoTableRow(lines, todoTask, fields)) return lines.join('\n');
  let startLine = Number.isInteger(todoTask?.sourceLine) && todoTitleAt(lines[todoTask.sourceLine]) === todoTask.title
    ? todoTask.sourceLine
    : -1;
  if (startLine < 0) {
    startLine = lines.findIndex((line) => todoTitleAt(line).toLowerCase() === String(todoTask?.title || '').toLowerCase());
  }
  if (startLine < 0) throw new Error('The linked todo item was not found.');

  let endLine = lines.length;
  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (todoTitleAt(lines[index])) {
      endLine = index;
      break;
    }
  }

  const pending = new Map(Object.entries(fields).map(([key, value]) => [key.toLowerCase(), { key, value }]));
  let insertAt = startLine + 1;
  for (let index = startLine + 1; index < endLine; index += 1) {
    const match = /^(\s{2,}-\s+)([^:]+):\s*(.*?)\s*$/.exec(lines[index]);
    if (!match) continue;
    insertAt = index + 1;
    const update = pending.get(match[2].trim().toLowerCase());
    if (!update) continue;
    lines[index] = `${match[1]}${match[2].trim()}: ${update.value}`;
    pending.delete(match[2].trim().toLowerCase());
  }

  [...pending.values()].reverse().forEach((update) => {
    lines.splice(insertAt, 0, `  - ${update.key}: ${update.value}`);
  });
  return lines.join('\n');
}

export function removeTodoTaskItem(text, todoTask) {
  const lines = String(text).split(/\r?\n/);
  if (Number.isInteger(todoTask?.sourceLine) && isTableRow(lines[todoTask.sourceLine])) {
    lines.splice(todoTask.sourceLine, 1);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  let startLine = Number.isInteger(todoTask?.sourceLine) && todoTitleAt(lines[todoTask.sourceLine]) === todoTask.title
    ? todoTask.sourceLine
    : -1;
  if (startLine < 0) {
    startLine = lines.findIndex((line) => todoTitleAt(line).toLowerCase() === String(todoTask?.title || '').toLowerCase());
  }
  if (startLine < 0) throw new Error('The linked todo item was not found.');

  let endLine = lines.length;
  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (todoTitleAt(lines[index])) {
      endLine = index;
      break;
    }
  }

  let removeStart = startLine;
  if (removeStart > 0 && !lines[removeStart - 1].trim() && (endLine >= lines.length || !lines[endLine]?.trim())) {
    removeStart -= 1;
  }
  lines.splice(removeStart, endLine - removeStart);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function appendUserFeedback(text, feedback, { savedAt = new Date().toISOString(), source = 'TaskManager user verification' } = {}) {
  const cleanFeedback = String(feedback || '').trim();
  if (!cleanFeedback) throw new Error('Enter the user verification feedback before saving.');
  const lines = [
    '',
    `### Feedback saved ${savedAt}`,
    '',
    `- Source: ${source}`,
    '- Status: User replied',
    '- Feedback:',
    ...cleanFeedback.split(/\r?\n/).map((line) => `  ${line.trimEnd()}`),
    '',
  ];
  const sectionHeading = '## User Verification Feedback';
  const sourceText = String(text || '').trimEnd();
  if (!new RegExp(`^${sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(sourceText)) {
    return `${sourceText}\n\n${sectionHeading}\n${lines.join('\n')}`;
  }
  return `${sourceText}\n${lines.join('\n')}`;
}

export function appendUserVerificationComment(text, comment, { savedAt = new Date().toISOString(), source = 'TaskManager user verification comment' } = {}) {
  const cleanComment = String(comment || '').trim();
  if (!cleanComment) throw new Error('Enter the user verification comment before sending it to the agent.');
  const lines = [
    '',
    `### Comment sent ${savedAt}`,
    '',
    `- Source: ${source}`,
    '- Status: Sent to Agent',
    '- Comment:',
    ...cleanComment.split(/\r?\n/).map((line) => `  ${line.trimEnd()}`),
    '',
  ];
  const sectionHeading = '## User Verification Comments';
  const sourceText = String(text || '').trimEnd();
  if (!new RegExp(`^${sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(sourceText)) {
    return `${sourceText}\n\n${sectionHeading}\n${lines.join('\n')}`;
  }
  return `${sourceText}\n${lines.join('\n')}`;
}
