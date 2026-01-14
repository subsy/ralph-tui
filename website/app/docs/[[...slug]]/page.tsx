/**
 * ABOUTME: Dynamic catch-all route for documentation pages.
 * Loads MDX content based on URL slug and renders with TableOfContents,
 * Breadcrumbs, and PrevNextNav components.
 */

import { notFound } from 'next/navigation';
import { getDocBySlug, getAllDocSlugs } from '@/lib/docs';
import { TableOfContents, Breadcrumbs, PrevNextNav } from '@/components/docs';
import { compileMDX } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypePrettyCode from 'rehype-pretty-code';
import { mdxComponents } from '@/mdx-components';

interface DocPageProps {
  params: Promise<{
    slug?: string[];
  }>;
}

/**
 * Generates static params for all documentation pages.
 */
export async function generateStaticParams() {
  const slugs = await getAllDocSlugs();
  return slugs.map((slug) => ({
    slug: slug.split('/'),
  }));
}

/**
 * Generates metadata for each documentation page.
 */
export async function generateMetadata({ params }: DocPageProps) {
  const resolvedParams = await params;
  // If no slug, we'll redirect in the page component
  if (!resolvedParams.slug || resolvedParams.slug.length === 0) {
    return {
      title: 'Documentation - Ralph TUI',
      description: 'Ralph TUI documentation',
    };
  }
  const slugPath = resolvedParams.slug.join('/');

  try {
    const { frontmatter } = await getDocBySlug(slugPath);
    return {
      title: frontmatter.title,
      description: frontmatter.description || `Documentation for ${frontmatter.title}`,
    };
  } catch {
    return {
      title: 'Documentation',
      description: 'Ralph TUI documentation',
    };
  }
}

/**
 * Documentation page component.
 * Renders MDX content with navigation components.
 */
export default async function DocPage({ params }: DocPageProps) {
  const resolvedParams = await params;

  // Redirect /docs to /docs/getting-started/introduction
  if (!resolvedParams.slug || resolvedParams.slug.length === 0) {
    const { redirect } = await import('next/navigation');
    redirect('/docs/getting-started/introduction');
  }

  // TypeScript doesn't know redirect() never returns, so we assert slug is defined
  const slug = resolvedParams.slug!;
  const slugPath = slug.join('/');
  const currentPath = '/docs/' + slugPath;

  let docData;
  try {
    docData = await getDocBySlug(slugPath);
  } catch {
    notFound();
  }

  const { content, frontmatter, toc } = docData;

  // Compile MDX content with plugins
  const { content: mdxContent } = await compileMDX({
    source: content,
    components: mdxComponents,
    options: {
      parseFrontmatter: false,
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          [
            rehypeAutolinkHeadings,
            {
              behavior: 'wrap',
              properties: {
                className: ['anchor'],
              },
            },
          ],
          [
            rehypePrettyCode,
            {
              theme: 'tokyo-night',
              keepBackground: true,
            },
          ],
        ],
      },
    },
  });

  return (
    <div className="flex gap-8 xl:gap-12">
      {/* Main content area */}
      <article className="min-w-0 flex-1 max-w-3xl">
        {/* Breadcrumbs */}
        <Breadcrumbs
          slug={slug}
          className="mb-6"
        />

        {/* Page title */}
        <header className="mb-8">
          <h1
            className={[
              'text-3xl font-bold tracking-tight',
              'bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-tertiary',
              'bg-clip-text text-transparent',
            ].join(' ')}
          >
            {frontmatter.title}
          </h1>
          {frontmatter.description && (
            <p className="mt-3 text-lg text-fg-muted leading-relaxed">
              {frontmatter.description}
            </p>
          )}
        </header>

        {/* MDX content */}
        <div className="prose dark:prose-invert max-w-none">
          {mdxContent}
        </div>

        {/* Previous/Next navigation */}
        <PrevNextNav currentPath={currentPath} />
      </article>

      {/* Table of Contents sidebar */}
      <aside
        className={[
          'hidden xl:block',
          'w-56 shrink-0',
        ].join(' ')}
      >
        <div className="sticky top-24">
          <TableOfContents items={toc} />
        </div>
      </aside>
    </div>
  );
}
