"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    Aegis?: new (options: Record<string, unknown>) => unknown;
    __doudouRum?: unknown;
  }
}

export function TencentRum() {
  useEffect(() => {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const isProductionSite =
      window.location.hostname === "www.321weiqi.com" &&
      window.location.pathname.startsWith("/doudou");
    const id = env?.VITE_TENCENT_RUM_ID?.trim() || (isProductionSite ? "aZ6vgcDzYqJYlWo1mR" : "");
    if (!id || window.__doudouRum) return;

    const start = () => {
      if (!window.Aegis || window.__doudouRum) return;
      window.__doudouRum = new window.Aegis({
        id,
        hostUrl: "https://rumt-zh.com",
        spa: true,
        reportApiSpeed: false,
        reportAssetSpeed: false,
        clickElementLog: false,
        consoleLog: false,
      });
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-doudou-rum="true"]');
    if (existing) {
      existing.addEventListener("load", start, { once: true });
      start();
      return () => existing.removeEventListener("load", start);
    }

    const script = document.createElement("script");
    script.src = "https://tam.cdn-go.cn/aegis-sdk/latest/aegis.min.js?max_age=3600";
    script.async = true;
    script.dataset.doudouRum = "true";
    script.addEventListener("load", start, { once: true });
    document.head.appendChild(script);
    return () => script.removeEventListener("load", start);
  }, []);

  return null;
}
