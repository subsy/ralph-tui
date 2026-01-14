/**
 * ABOUTME: Root layout component for the Ralph TUI website.
 * Configures fonts, metadata, theme provider, and global layout with Header and Footer.
 */

import type { Metadata, Viewport } from 'next';
import { fontVariables } from '@/lib/fonts';
import { ThemeProvider } from '@/components/theme-provider';
import { Header, Footer } from '@/components/layout';
import './globals.css';

const BASE_URL = 'https://ralph-tui.dev';

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Ralph TUI - AI Agent Loop Orchestrator',
    template: '%s | Ralph TUI',
  },
  description:
    'An AI agent loop orchestrator that manages autonomous coding agents through intelligent task routing and continuous delivery. Automate your development workflow with PRD-driven task execution.',
  keywords: [
    'AI',
    'agent',
    'orchestrator',
    'TUI',
    'terminal',
    'coding',
    'automation',
    'Claude',
    'OpenCode',
    'PRD',
    'task automation',
    'developer tools',
    'continuous delivery',
  ],
  authors: [{ name: 'Ralph TUI Team' }],
  creator: 'Ralph TUI Team',
  publisher: 'Ralph TUI',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: BASE_URL,
    siteName: 'Ralph TUI',
    title: 'Ralph TUI - AI Agent Loop Orchestrator',
    description:
      'An AI agent loop orchestrator that manages autonomous coding agents through intelligent task routing and continuous delivery.',
    images: [
      {
        url: '/og-image.svg',
        width: 1200,
        height: 630,
        alt: 'Ralph TUI - AI Agent Loop Orchestrator',
        type: 'image/svg+xml',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ralph TUI - AI Agent Loop Orchestrator',
    description:
      'An AI agent loop orchestrator that manages autonomous coding agents through intelligent task routing and continuous delivery.',
    images: ['/og-image.svg'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16', type: 'image/x-icon' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: '/favicon.svg',
  },
  manifest: undefined,
  alternates: {
    canonical: BASE_URL,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${fontVariables} font-sans antialiased`}>
        <ThemeProvider>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
