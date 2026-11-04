// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatToolResult } from '../../../../shared/remote-chat/views/ChatToolResult';

vi.mock('antd-mobile', () => ({ Toast: { show: vi.fn() } }));
vi.mock('../../../../shared/layout/AdaptiveSheet', () => ({ AdaptiveSheet: () => null }));

describe('Web tool resource links', () => {
  it('keeps untrusted executable resources inert while allowing web links', () => {
    const html = renderToStaticMarkup(<ChatToolResult item={{ id: 'tool', type: 'mcpToolCall',
      result: { content: [
        { type: 'resource_link', name: 'Unsafe resource', uri: 'javascript:alert(1)' },
        { type: 'resource_link', name: 'Embedded page', uri: 'data:text/html,<script>alert(1)</script>' },
        { type: 'resource_link', name: 'Documentation', uri: 'https://example.com/docs' },
      ] },
    }} />);
    expect(html).toContain('Unsafe resource');
    expect(html).toContain('Embedded page');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
    expect(html).toContain('href="https://example.com/docs"');
  });
});
