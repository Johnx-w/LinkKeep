"use client";

import { useState } from "react";

import type { Locale } from "@/i18n/messages";

export function CopyrightForm({ locale }: { locale: Locale }) {
  const [status, setStatus] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");
  const [reference, setReference] = useState("");

  async function submit(formData: FormData) {
    setStatus("submitting");
    const response = await fetch("/api/copyright", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: formData.get("platform"),
        postId: formData.get("postId"),
        contactEmail: formData.get("contactEmail"),
        statement: formData.get("statement"),
        website: formData.get("website"),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      reference?: string;
    };
    if (!response.ok) {
      setStatus("error");
      return;
    }
    setReference(body.reference ?? "");
    setStatus("done");
  }

  return (
    <form
      className="copyright-form"
      action={submit}
      aria-busy={status === "submitting"}
    >
      <label>
        {locale === "zh" ? "来源平台" : "Source platform"}
        <select name="platform" required>
          <option value="douyin">Douyin / 抖音</option>
          <option value="xiaohongshu">REDnote / 小红书</option>
        </select>
      </label>
      <label>
        {locale === "zh" ? "平台帖子编号" : "Platform post ID"}
        <input name="postId" minLength={3} maxLength={128} required />
      </label>
      <label>
        {locale === "zh" ? "联系邮箱" : "Contact email"}
        <input name="contactEmail" type="email" maxLength={254} required />
      </label>
      <label>
        {locale === "zh" ? "权利说明" : "Rights statement"}
        <textarea name="statement" minLength={20} maxLength={4000} required />
      </label>
      <label className="honeypot" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <button className="primary-button" type="submit">
        {status === "submitting"
          ? locale === "zh"
            ? "提交中…"
            : "Submitting…"
          : locale === "zh"
            ? "提交投诉"
            : "Submit report"}
      </button>
      <div aria-live="polite">
        {status === "done" &&
          (locale === "zh"
            ? `已收到，查询编号：${reference}`
            : `Received. Reference: ${reference}`)}
        {status === "error" &&
          (locale === "zh"
            ? "提交失败，请检查信息后重试。"
            : "Submission failed. Check the fields and retry.")}
      </div>
    </form>
  );
}
