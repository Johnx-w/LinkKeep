import { notFound } from "next/navigation";

import { FeedbackForm } from "@/components/feedback-form";
import { isLocale } from "@/i18n/messages";

export default async function FeedbackPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <article className="legal-page feedback-page">
      <h1>{locale === "zh" ? "问题反馈与建议" : "Feedback and suggestions"}</h1>
      <p>{locale === "zh"
        ? "解析失败、下载异常，或有想要的功能，都可以在这里告诉我们。遇到解析问题时，附上相关链接能帮助我们定位原因。"
        : "Tell us about parsing problems, download issues, or features you would like. Including the relevant link helps us investigate."}</p>
      <FeedbackForm locale={locale} />
    </article>
  );
}
