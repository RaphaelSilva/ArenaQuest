import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentSection } from '@web/components/catalog/ContentSection';

describe('ContentSection', () => {
  it('renders nothing when content is null', () => {
    const { container } = render(<ContentSection content={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when content is undefined', () => {
    const { container } = render(<ContentSection content={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when content is empty string', () => {
    const { container } = render(<ContentSection content="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when content is whitespace only', () => {
    const { container } = render(<ContentSection content="   " />);
    expect(container.firstChild).toBeNull();
  });

  it('renders content section with heading when content is provided', () => {
    const { container } = render(<ContentSection content="# Hello World" />);
    expect(screen.getByText('About This Topic')).toBeInTheDocument();
    expect(container.querySelector('section')).toBeInTheDocument();
  });

  it('renders markdown as HTML', () => {
    const { container } = render(
      <ContentSection content="# Heading\n\nSome **bold** text" />,
    );
    expect(container.querySelector('h1')).toBeInTheDocument();
    expect(container.querySelector('strong')).toBeInTheDocument();
  });

  it('sanitizes dangerous scripts', () => {
    const { container } = render(
      <ContentSection content="<script>alert('xss')</script>Safe content" />,
    );
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(screen.getByText(/Safe content/)).toBeInTheDocument();
  });

  it('sanitizes javascript: links in markdown', () => {
    const { container } = render(
      <ContentSection content="[Click me](javascript:alert('xss'))" />,
    );
    // The link should be stripped to just text
    const link = container.querySelector('a');
    if (link) {
      expect(link.href).not.toMatch(/javascript:/);
    }
  });
});
