import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  const title = "豆豆画室｜图片转拼豆图纸";
  const description = "上传一张图片，生成可编辑、可下载的拼豆预览和带色号图纸。无需登录，图片只在本地处理。";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: image, width: 1792, height: 896, alt: "豆豆画室" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
