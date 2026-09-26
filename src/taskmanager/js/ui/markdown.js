import { escapeHtml, slugify } from '../lib/utils.js';

function inline(value = '') {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function renderMarkdown(markdown = '') {
  const lines = String(markdown).replace(/<!--[\s\S]*?-->/g, '').replaceAll('\r\n', '\n').split('\n');
  const html = [];
  let list = null;
  let table = null;
  let code = null;

  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  const closeTable = () => {
    if (table) html.push('</tbody></table></div>');
    table = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (code !== null) {
      if (/^```/.test(line)) {
        html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) {
      closeList(); closeTable(); code = [];
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      closeList(); closeTable();
      const level = heading[1].length;
      html.push(`<h${level} id="${slugify(heading[2])}">${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*\|/.test(line) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      closeList();
      const headers = line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      html.push('<div class="markdown-table-wrap"><table><thead><tr>');
      headers.forEach((header) => html.push(`<th>${inline(header)}</th>`));
      html.push('</tr></thead><tbody>');
      table = true;
      index += 1;
      continue;
    }
    if (table && /^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      html.push('<tr>');
      cells.forEach((cell) => html.push(`<td>${inline(cell)}</td>`));
      html.push('</tr>');
      continue;
    }
    if (table) closeTable();

    const checkbox = /^\s*-\s+\[([ xX])\]\s+(.+)$/.exec(line);
    const unordered = /^\s*-\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (checkbox || unordered || ordered) {
      const nextList = ordered ? 'ol' : 'ul';
      if (list !== nextList) { closeList(); html.push(`<${nextList}>`); list = nextList; }
      if (checkbox) html.push(`<li class="markdown-check"><span class="check-box ${checkbox[1].toLowerCase() === 'x' ? 'checked' : ''}"></span><span>${inline(checkbox[2])}</span></li>`);
      else html.push(`<li>${inline((ordered || unordered)[1])}</li>`);
      continue;
    }
    closeList();
    const quote = /^>\s*(.+)$/.exec(line);
    if (quote) { html.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
    if (/^\s*---+\s*$/.test(line)) { html.push('<hr>'); continue; }
    if (!line.trim()) { html.push(''); continue; }
    html.push(`<p>${inline(line.trim())}</p>`);
  }
  closeList(); closeTable();
  if (code !== null) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return html.join('\n');
}
