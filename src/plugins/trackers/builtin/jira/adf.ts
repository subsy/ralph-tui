/**
 * ABOUTME: Atlassian Document Format (ADF) to Markdown converter.
 * Converts Jira's rich text format into readable markdown for agent prompts.
 * Handles common node types with graceful degradation for unsupported ones.
 */

import type { AdfDocument, AdfNode, AdfMark } from './types.js';

/**
 * Convert an ADF document to markdown.
 * Returns empty string for null/undefined input.
 */
export function adfToMarkdown(adf: AdfDocument | null | undefined): string {
  if (!adf || !adf.content) {
    return '';
  }

  return renderNodes(adf.content).trim();
}

/**
 * Render an array of ADF nodes to markdown.
 */
function renderNodes(nodes: AdfNode[]): string {
  return nodes.map((node) => renderNode(node)).join('');
}

/**
 * Render a single ADF node to markdown.
 */
function renderNode(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return renderText(node);

    case 'paragraph':
      return renderParagraph(node);

    case 'heading':
      return renderHeading(node);

    case 'bulletList':
      return renderList(node, 'bullet');

    case 'orderedList':
      return renderList(node, 'ordered');

    case 'listItem':
      return renderListItem(node);

    case 'codeBlock':
      return renderCodeBlock(node);

    case 'blockquote':
      return renderBlockquote(node);

    case 'rule':
      return '\n---\n\n';

    case 'table':
      return renderTable(node);

    case 'tableRow':
      return renderTableRow(node);

    case 'tableHeader':
    case 'tableCell':
      return renderTableCell(node);

    case 'hardBreak':
      return '\n';

    case 'mention':
      return renderMention(node);

    case 'inlineCard':
    case 'blockCard':
      return renderCard(node);

    case 'emoji':
      return renderEmoji(node);

    case 'mediaSingle':
    case 'media':
      // Media nodes can't be meaningfully rendered as markdown
      return '';

    case 'panel':
      return renderPanel(node);

    case 'expand':
      return renderExpand(node);

    default:
      // Graceful degradation: try to render children if present
      if (node.content) {
        return renderNodes(node.content);
      }
      return '';
  }
}

/**
 * Render a text node with marks (bold, italic, code, link, etc.)
 */
function renderText(node: AdfNode): string {
  let text = node.text ?? '';

  if (!node.marks || node.marks.length === 0) {
    return text;
  }

  // Apply marks from innermost to outermost
  for (const mark of node.marks) {
    text = applyMark(text, mark);
  }

  return text;
}

/**
 * Apply a single mark to text.
 */
function applyMark(text: string, mark: AdfMark): string {
  switch (mark.type) {
    case 'strong':
      return `**${text}**`;

    case 'em':
      return `*${text}*`;

    case 'code':
      return `\`${text}\``;

    case 'strike':
      return `~~${text}~~`;

    case 'link': {
      const href = mark.attrs?.href as string | undefined;
      return href ? `[${text}](${href})` : text;
    }

    case 'subsup': {
      const type = mark.attrs?.type as string | undefined;
      if (type === 'sub') return `~${text}~`;
      if (type === 'sup') return `^${text}^`;
      return text;
    }

    case 'textColor':
    case 'backgroundColor':
      // Colors can't be represented in markdown, pass through
      return text;

    default:
      return text;
  }
}

/**
 * Render a paragraph node.
 */
function renderParagraph(node: AdfNode): string {
  const content = node.content ? renderNodes(node.content) : '';
  return `${content}\n\n`;
}

/**
 * Render a heading node (h1-h6).
 */
function renderHeading(node: AdfNode): string {
  const level = (node.attrs?.level as number) ?? 1;
  const prefix = '#'.repeat(Math.min(level, 6));
  const content = node.content ? renderNodes(node.content) : '';
  return `${prefix} ${content}\n\n`;
}

/**
 * Render a list (bullet or ordered).
 */
function renderList(node: AdfNode, type: 'bullet' | 'ordered'): string {
  if (!node.content) return '';

  const items = node.content.map((item, index) => {
    const prefix = type === 'bullet' ? '- ' : `${index + 1}. `;
    const content = item.content ? renderListItemContent(item.content, prefix.length) : '';
    return `${prefix}${content}`;
  });

  return items.join('\n') + '\n\n';
}

/**
 * Render list item content, handling nested lists with indentation.
 */
function renderListItemContent(nodes: AdfNode[], indent: number): string {
  const parts: string[] = [];
  const indentStr = ' '.repeat(indent);

  for (const node of nodes) {
    if (node.type === 'paragraph') {
      // Inline the paragraph content (no double newline in list context)
      const paragraph = node.content ? renderNodes(node.content) : '';
      parts.push(parts.length === 0 ? paragraph : `\n\n${indentStr}${paragraph}`);
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      // Nested list: indent each line
      const nestedContent = renderNode(node).trimEnd();
      const indented = nestedContent
        .split('\n')
        .map((line) => `${indentStr}${line}`)
        .join('\n');
      parts.push('\n' + indented);
    } else {
      parts.push(renderNode(node));
    }
  }

  return parts.join('');
}

/**
 * Render a list item node (used when renderList delegates).
 */
function renderListItem(node: AdfNode): string {
  return node.content ? renderListItemContent(node.content, 2) : '';
}

/**
 * Render a code block with optional language.
 */
function renderCodeBlock(node: AdfNode): string {
  const language = (node.attrs?.language as string) ?? '';
  const content = node.content ? renderNodes(node.content) : '';
  return `\`\`\`${language}\n${content}\n\`\`\`\n\n`;
}

/**
 * Render a blockquote.
 */
function renderBlockquote(node: AdfNode): string {
  if (!node.content) return '';

  const content = renderNodes(node.content).trimEnd();
  const quoted = content
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${quoted}\n\n`;
}

/**
 * Render a table.
 */
function renderTable(node: AdfNode): string {
  if (!node.content || node.content.length === 0) return '';

  interface RowData {
    markdown: string;
    columnCount: number;
  }

  const rows: RowData[] = node.content
    .filter((row) => row.type === 'tableRow')
    .map((row) => {
      const cells = (row.content ?? []).map((cell) => {
        const content = cell.content ? renderNodes(cell.content).trim() : '';
        return content
          .replace(/\r?\n+/g, '<br>')
          .replace(/\|/g, '\\|'); // Escape pipes in cell content
      });
      return {
        markdown: `| ${cells.join(' | ')} |`,
        columnCount: cells.length,
      };
    });

  if (rows.length === 0) return '';

  // Insert separator after first row (header)
  const firstRow = rows[0];
  if (firstRow) {
    const separator = `|${' --- |'.repeat(firstRow.columnCount)}`;
    rows.splice(1, 0, { markdown: separator, columnCount: firstRow.columnCount });
  }

  return rows.map((row) => row.markdown).join('\n') + '\n\n';
}

/**
 * Render a table row (delegated from table renderer).
 */
function renderTableRow(node: AdfNode): string {
  if (!node.content) return '';
  const cells = node.content.map((cell) => renderNode(cell)).join(' | ');
  return `| ${cells} |`;
}

/**
 * Render a table cell or header.
 */
function renderTableCell(node: AdfNode): string {
  return node.content ? renderNodes(node.content).trim() : '';
}

/**
 * Render an @mention.
 */
function renderMention(node: AdfNode): string {
  const text = node.attrs?.text as string | undefined;
  return text ?? '@unknown';
}

/**
 * Render an inline/block card (link embed).
 */
function renderCard(node: AdfNode): string {
  const url = node.attrs?.url as string | undefined;
  return url ? `[${url}](${url})` : '';
}

/**
 * Render an emoji node.
 */
function renderEmoji(node: AdfNode): string {
  const shortName = node.attrs?.shortName as string | undefined;
  const text = node.attrs?.text as string | undefined;
  return text ?? shortName ?? '';
}

/**
 * Render a panel (info, note, warning, etc.)
 */
function renderPanel(node: AdfNode): string {
  const panelType = (node.attrs?.panelType as string) ?? 'info';
  const content = node.content ? renderNodes(node.content).trim() : '';
  const prefix = panelType.charAt(0).toUpperCase() + panelType.slice(1);
  const quoted = content
    .split('\n')
    .map((line, index) => (index === 0 ? `> **${prefix}:** ${line}` : `> ${line}`))
    .join('\n');
  return `${quoted}\n\n`;
}

/**
 * Render an expand/collapse section.
 */
function renderExpand(node: AdfNode): string {
  const title = (node.attrs?.title as string) ?? 'Details';
  const content = node.content ? renderNodes(node.content).trim() : '';
  return `<details>\n<summary>${title}</summary>\n\n${content}\n\n</details>\n\n`;
}

/**
 * Wrap plain text in a minimal ADF document.
 * Used for creating Jira comments via REST API v3.
 */
export function textToAdf(text: string): AdfDocument {
  return {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text,
          },
        ],
      },
    ],
  };
}

/**
 * Build a rich ADF completion comment for a Jira story.
 * Includes a status panel, acceptance criteria checklist, and optional notes.
 */
export function buildCompletionAdf(options: {
  taskId: string;
  taskTitle: string;
  acceptanceCriteria?: string[];
  reason?: string;
  durationMs?: number;
}): AdfDocument {
  const content: AdfNode[] = [];

  // Header panel
  content.push({
    type: 'panel',
    attrs: { panelType: 'success' },
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '✅ Completed by Ralph TUI', marks: [{ type: 'strong' }] },
        ],
      },
    ],
  });

  // Reason / summary
  if (options.reason && options.reason !== 'Completed by agent') {
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Summary: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: options.reason },
      ],
    });
  }

  // Acceptance criteria checklist
  if (options.acceptanceCriteria && options.acceptanceCriteria.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Acceptance Criteria' }],
    });

    content.push({
      type: 'bulletList',
      content: options.acceptanceCriteria.map((criterion) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `✅ ${criterion}` }],
          },
        ],
      })),
    });
  }

  // Duration
  if (options.durationMs) {
    const seconds = Math.round(options.durationMs / 1000);
    const timeStr = seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${seconds}s`;
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Duration: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: timeStr },
      ],
    });
  }

  return {
    version: 1,
    type: 'doc',
    content,
  };
}
