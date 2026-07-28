import { notFound } from "next/navigation";

import { Downloader } from "@/components/downloader";
import { isLocale } from "@/i18n/messages";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <Downloader locale={locale} />;
}
