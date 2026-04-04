import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next";

import { Toaster } from "@/components/ui/sonner";
import { TRPCReactProvider } from "@/trpc/client";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meet.AI — AI-Powered Video Meetings",
  description: "Real-time AI voice agents in your meetings. Get automatic transcripts and summaries powered by Google Gemini.",
  keywords: ["AI meetings", "video call", "AI agent", "transcript", "Google Gemini"],
  openGraph: {
    title: "Meet.AI",
    description: "AI-powered video meetings with real-time agents.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.className} antialiased`}
      >
        <NuqsAdapter>
          <TRPCReactProvider>
            <Toaster />
            {children}
          </TRPCReactProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
