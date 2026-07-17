import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BeadStudio } from "./BeadStudio";
import "./globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("页面入口加载失败");
}

createRoot(root).render(
  <StrictMode>
    <BeadStudio />
  </StrictMode>,
);
