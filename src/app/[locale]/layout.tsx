import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { isLocale, locales } from "@/i18n/messages";
import { SiteShell } from "@/components/site-shell";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <SiteShell locale={locale}>{children}</SiteShell>;
}
