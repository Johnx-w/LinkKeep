import { notFound } from "next/navigation";

import { LegalContent } from "@/components/legal-content";
import { isLocale } from "@/i18n/messages";

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <LegalContent locale={locale} kind="terms" />;
}
