import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
  compact?: boolean;
  testId?: string;
}

export function MarkdownContent({ content, compact = false, testId }: Props) {
  return <div className={`markdown-document ${compact ? "markdown-document-compact" : ""}`} data-testid={testId}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ node: _node, href, children, ...props }) => <a
          {...props}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
        >{children}</a>,
        img: ({ node: _node, src, alt }) => <span className="markdown-image-placeholder" title={src}>Image · {alt || src || "attachment"}</span>,
      }}
    >{content}</ReactMarkdown>
  </div>;
}
