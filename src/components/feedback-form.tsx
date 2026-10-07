"use client";

import { useState } from "react";
import Link from "next/link";

import type { Locale } from "@/i18n/messages";

export function FeedbackForm({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");

  async function submit(formData: FormData) {
    if (status === "submitting") return;
    setStatus("submitting");
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: formData.get("message"),
          problemUrl: formData.get("problemUrl"),
          contactEmail: formData.get("contactEmail"),
          website: formData.get("website"),
        }),
      });
      const body = await response.json() as { reference?: string };
      if (!response.ok || !body.reference) {
        setError(response.status === 429
          ? zh ? "提交较频繁，请稍后再试。" : "Too many submissions. Please try later."
          : zh ? "提交失败，请检查信息后重试。" : "Submission failed. Check your details and try again.");
        setStatus("error");
        return;
      }
      setReference(body.reference);
      setStatus("done");
    } catch {
      setError(zh ? "网络连接失败，请稍后重试。" : "Connection failed. Please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="feedback-success" role="status">
        <strong>{zh ? "反馈已收到，谢谢你的帮助。" : "Feedback received. Thank you for helping."}</strong>
        <p>{zh ? "反馈编号：" : "Reference: "}{reference}</p>
        <p><Link href={`/${locale}`}>{zh ? "返回首页" : "Back to home"}</Link></p>
      </div>
    );
  }

  return (
    <form className="copyright-form feedback-form" action={submit} aria-busy={status === "submitting"}>
      <label>
        {zh ? "反馈内容" : "Your feedback"}
        <textarea name="message" minLength={5} maxLength={4000} required
          placeholder={zh ? "描述遇到的问题，或告诉我们你的建议。" : "Describe the problem or share your suggestion."} />
      </label>
      <label>
        {zh ? "问题链接（选填）" : "Problem link (optional)"}
        <input name="problemUrl" type="url" maxLength={2048}
          placeholder={zh ? "粘贴解析失败的视频或图片链接" : "Paste the video or image link that failed"} />
      </label>
      <label>
        {zh ? "联系邮箱（选填）" : "Contact email (optional)"}
        <input name="contactEmail" type="email" maxLength={254} autoComplete="email"
          placeholder={zh ? "如果希望收到回复，请留下你的邮箱" : "Leave your email if you would like a reply"} />
      </label>
      <label className="honeypot" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <p className="feedback-note">
        {zh ? "请勿填写密码、验证码或其他敏感信息。" : "Please do not include passwords, verification codes, or other sensitive details."}
      </p>
      <button className="feedback-submit" type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? zh ? "提交中…" : "Submitting…" : zh ? "提交反馈" : "Send feedback"}
      </button>
      {status === "error" && <p role="alert">{error}</p>}
    </form>
  );
}
