import { describe, expect, it } from "vitest";
import { readPageState } from "@/platforms/page-state";

describe("公开页面 JSON 状态", () => {
  it("读取手机分享页状态并保留字符串里的 undefined、分号和括号", () => {
    expect(readPageState('<script>window.__STATE__={"title":"undefined; }", "missing":undefined,"nested":[{"v":1}]};</script>', "__STATE__"))
      .toEqual({ title: "undefined; }", missing: null, nested: [{ v: 1 }] });
  });
  it("不执行页面表达式或接受被截断的数据", () => {
    expect(readPageState('window.__STATE__=JSON.parse("{}");', "__STATE__")).toBeUndefined();
    expect(readPageState('window.__STATE__={"a":1', "__STATE__")).toBeUndefined();
    expect(readPageState('window.__STATE__={"a":(()=>1)()};', "__STATE__")).toBeUndefined();
  });
});
