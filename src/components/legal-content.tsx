import type { Locale } from "@/i18n/messages";

type LegalKind = "terms" | "privacy";

const content = {
  zh: {
    terms: {
      title: "服务条款",
      sections: [
        [
          "服务范围",
          "LinkKeep 仅识别抖音和小红书无需登录即可访问的普通公开媒体。我们不保证所有链接可解析，不保证平台分发版等同上传原件，也不绕过登录、付费、地区、DRM、签名或风控。",
        ],
        [
          "你的责任",
          "你只能保存自己拥有权利或已获授权的内容，并确保保存、复制、编辑、发布或商业使用符合适用法律和来源平台规则。“个人学习”不自动构成使用授权。",
        ],
        [
          "禁止行为",
          "不得批量或自动化滥用服务，不得侵犯知识产权、隐私或其他合法权益，不得攻击、探测或利用本服务访问受限内容。",
        ],
        [
          "临时处理",
          "本站不长期保存媒体。为完成解析、ZIP 或代理传输，可能临时处理或缓存媒体，最长 15 分钟后删除。结果不可永久分享或恢复。",
        ],
        [
          "服务变化",
          "来源平台变化可能导致部分能力中断。我们可为保护安全、预算和权利人权益而熔断平台、拒绝指定帖子或停止服务。",
        ],
        [
          "平台关系",
          "LinkKeep 与抖音、小红书及其关联公司无隶属、合作、授权或认可关系；平台名称仅用于兼容性说明。",
        ],
      ],
    },
    privacy: {
      title: "隐私政策",
      sections: [
        [
          "我们处理什么",
          "分享输入仅用于当次解析；完整分享文本和完整媒体 URL 不写入业务日志。媒体和结果最长保留 15 分钟。",
        ],
        [
          "日志与留存",
          "诊断日志保留 7 天，聚合指标保留 30 天，不用于长期用户画像。",
        ],
        [
          "直连下载",
          "选择直连下载时，你的设备会直接请求来源平台，因此来源平台会收到你的网络地址和浏览器请求信息。本站设置不发送来源页 Referrer，但无法隐藏你的网络地址。",
        ],
        [
          "投诉信息",
          "投诉只收集处理所需的联系方式、帖子标识和权利说明。处理完成后个人资料保留 180 天；不附带投诉人资料的停止解析标识可长期保留。",
        ],
        [
          "运营安全",
          "运营后台与访客流程隔离。数据库每日加密备份，媒体缓存和诊断日志不进入备份。",
        ],
      ],
    },
  },
  en: {
    terms: {
      title: "Terms of Service",
      sections: [
        [
          "Service scope",
          "LinkKeep only identifies ordinary public media from Douyin and REDnote that is accessible without login. We do not guarantee every link, the uploader's original file, or any bypass of login, payment, region, DRM, signatures, or platform controls.",
        ],
        [
          "Your responsibility",
          "You may only save content you own or are authorized to use. Saving, copying, editing, publishing, and commercial use must comply with applicable law and source-platform rules. “Personal study” is not universal permission.",
        ],
        [
          "Prohibited use",
          "Do not automate or abuse the service, infringe intellectual property or privacy, attack or probe the service, or use it to access restricted content.",
        ],
        [
          "Temporary processing",
          "We do not retain media long term. Parsing, local ZIP support, or proxy delivery may involve temporary processing or caching for no more than 15 minutes. Results are not permanent or recoverable.",
        ],
        [
          "Service changes",
          "Source-platform changes can interrupt features. We may disable a platform, reject a specific post, or suspend service to protect security, budget, and rights holders.",
        ],
        [
          "No affiliation",
          "LinkKeep is not affiliated with, authorized by, or endorsed by Douyin, REDnote, or their affiliates. Platform names only describe compatibility.",
        ],
      ],
    },
    privacy: {
      title: "Privacy Policy",
      sections: [
        [
          "What we process",
          "Share input is used only for the current parse. Complete share text and media URLs are not written to business logs. Media and results expire within 15 minutes.",
        ],
        [
          "Logs and retention",
          "Diagnostic logs last 7 days and aggregate metrics 30 days; neither creates a long-term visitor profile.",
        ],
        [
          "Direct downloads",
          "A direct download contacts the source platform from your device, so it receives your network address and browser request data. We suppress the referring page where possible but cannot hide your network address.",
        ],
        [
          "Copyright reports",
          "Reports collect only contact details, post identification, and the rights statement needed to process them. Personal data is retained for 180 days after resolution; a post block without reporter data may remain longer.",
        ],
        [
          "Operational security",
          "The operator console is isolated from visitors. The database is backed up encrypted each day; media caches and diagnostic logs are excluded.",
        ],
      ],
    },
  },
} as const;

export function LegalContent({
  locale,
  kind,
}: {
  locale: Locale;
  kind: LegalKind;
}) {
  const page = content[locale][kind];
  return (
    <article className="legal-page">
      <h1>{page.title}</h1>
      {page.sections.map(([title, paragraph]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{paragraph}</p>
        </section>
      ))}
      <p>
        {locale === "zh"
          ? "最后更新：2026 年 7 月 27 日"
          : "Last updated: July 27, 2026"}
      </p>
    </article>
  );
}
