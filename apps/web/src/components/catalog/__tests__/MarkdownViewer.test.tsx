import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MarkdownViewer } from '../MarkdownViewer';

describe('MarkdownViewer', () => {
  it('renders standard markdown correctly', () => {
    const { container } = render(<MarkdownViewer content={'# Hello World\n\nThis is a test.'} />);
    expect(container.innerHTML).toMatch(/<h1.*>Hello World.*<\/h1>/);
    expect(container.innerHTML).toMatch(/<p>This is a test.<\/p>/);
  });

  it('sanitizes dangerous scripts', () => {
    const { container } = render(<MarkdownViewer content={'# Title\n\n<script>alert("XSS")</script>'} />);
    expect(container.innerHTML).toMatch(/<h1.*>Title.*<\/h1>/);
    expect(container.innerHTML).not.toContain('<script>');
    expect(container.innerHTML).not.toContain('alert');
  });

  it('sanitizes javascript links', () => {
    const { container } = render(<MarkdownViewer content="[Click me](javascript:alert('XSS'))" />);
    // The sanitizer might remove the link entirely or strip the href.
    // Our shared sanitizer replaces the markdown link with just the text or strips href.
    expect(container.innerHTML).not.toContain('javascript:alert');
  });

  it('preserves legitimate safe HTML', () => {
    const { container } = render(<MarkdownViewer content="This is **bold** and *italic*." />);
    expect(container.innerHTML).toContain('<strong>bold</strong>');
    expect(container.innerHTML).toContain('<em>italic</em>');
  });
});
