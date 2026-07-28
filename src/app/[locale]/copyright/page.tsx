import { notFound } from "next/navigation";

import { env } from "@/config/env";
import { CopyrightForm } from "@/components/copyright-form";
import { isLocale } from "@/i18n/messages";

export default async function CopyrightPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <article className="legal-page">
      <h1>{locale === "zh" ? "版权投诉" : "Copyright report"}</h1>
      <p>
        {locale === "zh"
          ? "如果你是相关权利人或获授权代表，请提供指定帖子编号、可联系邮箱及权利说明。核实后我们会停止解析该条帖子并清除临时结果，不会因此屏蔽作者其他内容。"
          : "If you are the relevant rights holder or an authorized representative, provide the post ID, a contact email, and your rights statement. Once verified, we will stop parsing that post and clear temporary results without blocking the author's other posts."}
      </p>
      <p>
        {locale === "zh" ? "也可发送邮件至：" : "You may also email: "}
        <a href={`mailto:${env.COPYRIGHT_EMAIL}`}>{env.COPYRIGHT_EMAIL}</a>
      </p>
      <CopyrightForm locale={locale} />
    </article>
  );
}
