"use client";
import { usePathname } from "next/navigation";

/** 落地頁 /about 不顯示站內頁首與頁尾（頁首選單、搜尋、使用者選單） */
export default function HideOnAbout({ children }: { children: React.ReactNode }) {
  return usePathname() === "/about" ? null : <>{children}</>;
}
