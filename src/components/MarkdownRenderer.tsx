import { useMemo } from 'react';

// Simple markdown parser for chat messages
// Supports: code blocks (```), inline code (`), bold, italic, links

interface MarkdownSegment {
  type: 'text' | 'codeBlock' | 'inlineCode' | 'bold' | 'italic' | 'link';
  content: string;
  language?: string;
  href?: string;
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
    const nextSpecial = remaining.search(/```|`|\*\*|\*|\[http/);
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

// Code Block View
function CodeBlockView({ code, language }: { code: string; language?: string }) {
  return (
    <div className="bg-white/[0.08] rounded-md my-1 overflow-hidden">
      {language && (
        <div className="text-[10px] text-white/40 px-2 py-0.5 border-b border-white/10">
          {language}
        </div>
      )}
      <pre className="text-[11px] text-white/85 font-mono p-2 overflow-x-auto whitespace-pre-wrap">
        {code}
      </pre>
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
    default:
      return <span>{segment.content}</span>;
  }
}

// Main Markdown renderer
export function MarkdownText({
  text,
  colorClass = 'text-white/90',
  fontSize = 'text-xs',
}: {
  text: string;
  colorClass?: string;
  fontSize?: string;
}) {
  const segments = useMemo(() => parseMarkdown(text), [text]);

  return (
    <div className={`${fontSize} ${colorClass} leading-relaxed`}>
      {segments.map((segment, idx) => {
        if (segment.type === 'codeBlock') {
          return <CodeBlockView key={idx} code={segment.content} language={segment.language} />;
        }
        return <InlineSegment key={idx} segment={segment} />;
      })}
    </div>
  );
}

// Compact version for tool results
export function CompactMarkdown({ text }: { text: string }) {
  const segments = useMemo(() => parseMarkdown(text), [text]);

  // For compact display, show first code block or truncate text
  const firstCodeBlock = segments.find(s => s.type === 'codeBlock');
  if (firstCodeBlock) {
    const lines = firstCodeBlock.content.split('\n');
    const preview = lines.slice(0, 3).join('\n');
    const hasMore = lines.length > 3;
    return (
      <div className="text-[11px] font-mono text-white/70 bg-white/[0.06] px-1.5 py-1 rounded">
        <pre className="whitespace-pre-wrap">{preview}{hasMore ? '\n...' : ''}</pre>
      </div>
    );
  }

  // Regular text - truncate
  const textContent = segments
    .filter(s => s.type === 'text')
    .map(s => s.content)
    .join('');

  if (textContent.length > 60) {
    return <span className="text-[11px] text-white/50">{textContent.slice(0, 60)}...</span>;
  }

  return (
    <span className="text-[11px] text-white/70">
      {segments.map((segment, idx) => (
        <InlineSegment key={idx} segment={segment} />
      ))}
    </span>
  );
}