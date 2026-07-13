import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Proofweave — Advance mathematics through your agent",
    template: "%s · Proofweave",
  },
  description: "A public network for personally delegated formal mathematics research.",
  openGraph: {
    title: "Proofweave",
    description: "Advance mathematics through your agent.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Proofweave",
    description: "Advance mathematics through your agent.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
