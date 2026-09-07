import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MergeMate - Autonomous AI GitHub Contributor',
  description: 'ChatGPT-like AI agent that discovers open-source issues, writes code fixes, and submits Pull Requests on GitHub.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#080c14] text-slate-100 min-h-screen flex flex-col antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        {children}
      </body>
    </html>
  );
}
