import { type Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { htmlLang, pathForLocale, stripLocalePrefix } from "@/app/i18n/config";
import { I18nProvider } from "@/app/i18n/client";
import { clientDictionaryCore } from "@/app/i18n/client-dictionary";
import { getI18n } from "@/app/i18n/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  const requestHeaders = await headers();
  const canonicalPath = pathForLocale(stripLocalePrefix(requestHeaders.get("x-pw-pathname") ?? "/"), locale);
  return {
    metadataBase: new URL("https://proofweave.org"),
    title: {
      default: t("site.title"),
      template: "%s · Proofweave",
    },
    description: t("site.description"),
    alternates: {
      canonical: canonicalPath,
      languages: {
        en: pathForLocale(stripLocalePrefix(canonicalPath), "en"),
        "zh-CN": pathForLocale(stripLocalePrefix(canonicalPath), "zh-CN"),
        "x-default": pathForLocale(stripLocalePrefix(canonicalPath), "en"),
      },
    },
    openGraph: {
      url: canonicalPath,
      title: "Proofweave",
      description: t("site.ogDescription"),
      locale: locale === "zh-CN" ? "zh_CN" : "en_US",
      alternateLocale: [locale === "zh-CN" ? "en_US" : "zh_CN"],
      images: ["/og.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: "Proofweave",
      description: t("site.ogDescription"),
      images: ["/og.png"],
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, dictionary } = await getI18n();
  return (
    <html lang={htmlLang[locale]}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <I18nProvider locale={locale} dictionary={clientDictionaryCore(dictionary)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
