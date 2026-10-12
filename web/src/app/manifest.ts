import type { MetadataRoute } from "next";

/** 讓手機「加入主畫面」後像 APP 一樣全螢幕開啟（PWA）。 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "股見未來",
    short_name: "股見未來",
    description: "台股盤後選股：基本面、技術面、籌碼面篩選",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "zh-Hant-TW",
    background_color: "#f5f6f8",
    theme_color: "#2b4c9b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
