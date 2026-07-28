import Link from "next/link";
import type { ReactNode } from "react";

import { messages, type Locale } from "@/i18n/messages";

export function SiteShell({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const text = messages[locale];
  const alternate = locale === "zh" ? "en" : "zh";

  return (
    <div className="site-shell">
      <header className="site-header">
        <Link className="brand" href={`/${locale}`} aria-label="LinkKeep">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <span>
            <strong>LinkKeep</strong>
            <small>{text.brandSubtitle}</small>
          </span>
        </Link>
        <nav aria-label={locale === "zh" ? "网站导航" : "Site navigation"}>
          <Link className="language-link" href={`/${alternate}`}>
            {alternate === "zh" ? "中文" : "English"}
          </Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <p>{text.footerRights}</p>
        <nav aria-label={locale === "zh" ? "法律信息" : "Legal"}>
          <Link href={`/${locale}/terms`}>{text.terms}</Link>
          <Link href={`/${locale}/privacy`}>{text.privacy}</Link>
          <Link href={`/${locale}/copyright`}>{text.copyright}</Link>
        </nav>
        <p className="non-affiliation">
          {locale === "zh"
            ? "视频等内容版权归相关网站及作者所有，本站不存储任何视频及图片。"
            : "Copyright of videos and other content belongs to the respective sites and authors. This site does not store any videos or images."}
        </p>
      </footer>
    </div>
  );
}
