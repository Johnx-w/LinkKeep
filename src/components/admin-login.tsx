"use client";

import { useState } from "react";

export function AdminLogin() {
  const [error, setError] = useState("");

  async function submit(formData: FormData) {
    setError("");
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: formData.get("password"),
        secondFactor: formData.get("secondFactor"),
      }),
    });
    if (!response.ok) {
      setError("登录失败或尝试次数过多。");
      return;
    }
    window.location.reload();
  }

  return (
    <main className="admin-login">
      <form action={submit}>
        <p className="eyebrow">Operator only</p>
        <h1>LinkKeep 运营后台</h1>
        <label>
          管理员密码
          <input
            name="password"
            type="password"
            minLength={12}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          TOTP 动态验证码或恢复码
          <input
            name="secondFactor"
            autoComplete="one-time-code"
            required
          />
        </label>
        <button className="primary-button" type="submit">
          登录
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
