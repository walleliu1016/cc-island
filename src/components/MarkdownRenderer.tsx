import { useMemo, useState, useRef, useEffect } from 'react';

// Simple markdown parser for chat messages
// Supports: code blocks (```), inline code (`), bold, italic, links, tables

interface MarkdownSegment {
  type: 'text' | 'codeBlock' | 'inlineCode' | 'bold' | 'italic' | 'link' | 'table';
  content: string;
  language?: string;
  href?: string;
  tableRows?: string[][];
}

function parseMarkdown(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Code block: ```language\ncode\n```
    const codeBlockMatch = remaining.match(/^```(\w*)\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      segments.push({
        type: 'codeBlock',
        content: codeBlockMatch[2],
        language: codeBlockMatch[1] || 'text',
      });
      remaining = remaining.slice(codeBlockMatch[0].length);
      continue;
    }

    // Table: | header | header | ... | followed by separator and rows
    const tableMatch = remaining.match(/^\|([^\n]+)\|\n\|[-:\s|]+\|\n(\|[^\n]+\|\n?)+/);
    if (tableMatch) {
      const tableText = tableMatch[0];
      const rows: string[][] = [];
      const lines = tableText.trim().split('\n');

      for (const line of lines) {
        // Skip separator line (contains only dashes, colons, pipes, spaces)
        if (line.match(/^\|[-:\s|]+\|$/) || line.match(/^[-:\s|]+$/)) continue;

        // Parse row: | cell | cell | ... |
        const cells = line
          .split('|')
          .map(cell => cell.trim())
          .filter(cell => cell.length > 0);
        if (cells.length > 0) {
          rows.push(cells);
        }
      }

      if (rows.length > 0) {
        segments.push({
          type: 'table',
          content: tableText,
          tableRows: rows,
        });
      }
      remaining = remaining.slice(tableMatch[0].length);
      continue;
    }

    // Inline code: `code`
    const inlineCodeMatch = remaining.match(/^`([^`]+)`/);
    if (inlineCodeMatch) {
      segments.push({
        type: 'inlineCode',
        content: inlineCodeMatch[1],
      });
      remaining = remaining.slice(inlineCodeMatch[0].length);
      continue;
    }

    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      segments.push({
        type: 'bold',
        content: boldMatch[1],
      });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text*
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      segments.push({
        type: 'italic',
        content: italicMatch[1],
      });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      segments.push({
        type: 'link',
        content: linkMatch[1],
        href: linkMatch[2],
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Regular text - find next special marker or take all
    const nextSpecial = remaining.search(/```|`|\*\*|\*|\[|^\|/m);
    if (nextSpecial === -1) {
      segments.push({ type: 'text', content: remaining });
      break;
    } else if (nextSpecial === 0) {
      // No match found at start, take one char
      segments.push({ type: 'text', content: remaining[0] });
      remaining = remaining.slice(1);
    } else {
      segments.push({ type: 'text', content: remaining.slice(0, nextSpecial) });
      remaining = remaining.slice(nextSpecial);
    }
  }

  return segments;
}

// Code Block View - Collapsible with preview
function CodeBlockView({ code, language, maxLines = 5 }: { code: string; language?: string; maxLines?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const lines = code.split('\n');
  const totalLines = lines.length;
  const previewLines = lines.slice(0, maxLines);
  const hasMore = totalLines > maxLines;

  return (
    <div className="bg-white/[0.08] rounded-md my-1 overflow-hidden max-w-full">
      {language && (
        <div className="text-[10px] text-white/40 px-2 py-0.5 border-b border-white/10 flex items-center justify-between">
          <span>{language}</span>
          {hasMore && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-white/50 hover:text-white/80"
            >
              {isExpanded ? '收起' : `${totalLines} 行`}
            </button>
          )}
        </div>
      )}
      <pre className="text-[11px] text-white/85 font-mono p-2 overflow-x-auto whitespace-pre-wrap break-all max-w-full">
        {isExpanded ? code : previewLines.join('\n')}
        {!isExpanded && hasMore && '\n...'}
      </pre>
      {!language && hasMore && !isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="text-[10px] text-white/50 px-2 py-0.5 hover:text-white/80 w-full text-center"
        >
          展开 {totalLines} 行
        </button>
      )}
    </div>
  );
}

// Table View - Markdown table rendering
function TableView({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;

  const headerRow = rows[0];
  const bodyRows = rows.slice(1);

  return (
    <div className="overflow-x-auto my-1 max-w-full">
      <table className="text-[11px] border-collapse">
        <thead>
          <tr>
            {headerRow.map((cell, idx) => (
              <th
                key={idx}
                className="px-2 py-1 text-left text-white/70 border-b border-white/20 font-medium"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {row.map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  className="px-2 py-0.5 text-white/60 border-b border-white/10"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Inline elements
function InlineSegment({ segment }: { segment: MarkdownSegment }) {
  switch (segment.type) {
    case 'inlineCode':
      return (
        <code className="text-[11px] font-mono bg-white/[0.08] px-1 py-0.5 rounded">
          {segment.content}
        </code>
      );
    case 'bold':
      return <strong className="font-semibold">{segment.content}</strong>;
    case 'italic':
      return <em className="italic">{segment.content}</em>;
    case 'link':
      return (
        <a
          href={segment.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 underline hover:text-blue-300"
        >
          {segment.content}
        </a>
      );
    case 'table':
      return segment.tableRows ? <TableView rows={segment.tableRows} /> : null;
    default:
      return <span>{segment.content}</span>;
  }
}

// Main Markdown renderer - use CSS truncation to preserve formatting
export function MarkdownText({
  text,
  colorClass = 'text-white/90',
  fontSize = 'text-xs',
  maxLines = 8,
}: {
  text: string;
  colorClass?: string;
  fontSize?: string;
  maxLines?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [needsExpand, setNeedsExpand] = useState(false);
  const segments = useMemo(() => parseMarkdown(text), [text]);

  // Check if content overflows
  useEffect(() => {
    if (containerRef.current && !isExpanded) {
      const el = containerRef.current;
      // Check if content is taller than expected (approx line height * maxLines)
      const lineHeight = 16; // approx for text-xs
      const maxHeight = lineHeight * maxLines;
      setNeedsExpand(el.scrollHeight > maxHeight + 10);
    }
  }, [segments, isExpanded, maxLines]);

  return (
    <div className={`${fontSize} ${colorClass} leading-relaxed`}>
      <div
        ref={containerRef}
        className={!isExpanded && needsExpand ? `max-h-[${maxLines * 16}px] overflow-hidden` : ''}
      >
        {segments.map((segment, idx) => {
          if (segment.type === 'codeBlock') {
            return <CodeBlockView key={idx} code={segment.content} language={segment.language} maxLines={5} />;
          }
          if (segment.type === 'table') {
            return segment.tableRows ? <TableView key={idx} rows={segment.tableRows} /> : null;
          }
          return <InlineSegment key={idx} segment={segment} />;
        })}
      </div>
      {needsExpand && !isExpanded && (
        <div className="relative -mt-4 pt-4 bg-gradient-to-t from-black/80 to-transparent">
          <button
            onClick={() => setIsExpanded(true)}
            className="text-[10px] text-white/50 hover:text-white/80"
          >
            展开全部
          </button>
        </div>
      )}
      {isExpanded && needsExpand && (
        <button
          onClick={() => setIsExpanded(false)}
          className="text-[10px] text-white/50 hover:text-white/80 mt-1"
        >
          收起
        </button>
      )}
    </div>
  );
}

// Compact version for tool results - always truncated
export function CompactMarkdown({ text, maxLines = 3 }: { text: string; maxLines?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const segments = useMemo(() => parseMarkdown(text), [text]);

  // For compact display, show first code block or truncate text
  const firstCodeBlock = segments.find(s => s.type === 'codeBlock');
  if (firstCodeBlock) {
    const lines = firstCodeBlock.content.split('\n');
    const preview = lines.slice(0, maxLines).join('\n');
    const hasMore = lines.length > maxLines;
    return (
      <div className="text-[11px] font-mono text-white/70 bg-white/[0.06] px-1.5 py-1 rounded max-w-full">
        {isExpanded ? (
          <pre className="whitespace-pre-wrap break-all">{firstCodeBlock.content}</pre>
        ) : (
          <pre className="whitespace-pre-wrap break-all">{preview}{hasMore ? '\n...' : ''}</pre>
        )}
        {hasMore && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[10px] text-white/50 hover:text-white/80 mt-0.5"
          >
            {isExpanded ? '收起' : `展开 ${lines.length} 行`}
          </button>
        )}
      </div>
    );
  }

  // Show table if present
  const firstTable = segments.find(s => s.type === 'table');
  if (firstTable && firstTable.tableRows) {
    return <TableView rows={firstTable.tableRows} />;
  }

  // Regular text - use truncation
  if (text.length > 150 && !isExpanded) {
    return (
      <div>
        <span className="text-[11px] text-white/60">{text.slice(0, 150)}...</span>
        <button
          onClick={() => setIsExpanded(true)}
          className="text-[10px] text-white/50 hover:text-white/80 ml-1"
        >
          展开
        </button>
      </div>
    );
  }

  return (
    <span className="text-[11px] text-white/70">
      {segments.map((segment, idx) => (
        <InlineSegment key={idx} segment={segment} />
      ))}
      {isExpanded && text.length > 150 && (
        <button
          onClick={() => setIsExpanded(false)}
          className="text-[10px] text-white/50 hover:text-white/80 ml-1"
        >
          收起
        </button>
      )}
    </span>
  );
}