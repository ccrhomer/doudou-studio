"use client";

import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { TencentRum } from "./TencentRum";

type Mode = "detail" | "blocks" | "simple";
type Tool = "paint" | "erase" | "pick";
type InteractionMode = "view" | "edit";
type MobilePanel = "settings" | "canvas" | "export";
type BeadCell = number;

type PaletteColor = {
  code: string;
  name: string;
  hex: string;
  rgb: [number, number, number];
  lab: [number, number, number];
};

const EMPTY = -1;

const PALETTE_SOURCE: Array<[string, string, string]> = [
  ["A01", "奶油白", "#F7F4E8"],
  ["A02", "柠檬黄", "#F7D84A"],
  ["A03", "蜜糖黄", "#F4B942"],
  ["A04", "暖橙", "#ED8A3B"],
  ["A05", "珊瑚红", "#E65C5C"],
  ["A06", "莓果红", "#C93E5A"],
  ["B01", "樱花粉", "#F3B8C4"],
  ["B02", "蜜桃粉", "#EE8FA7"],
  ["B03", "葡萄紫", "#9B71B3"],
  ["B04", "深紫", "#68477E"],
  ["C01", "天空蓝", "#77BDE8"],
  ["C02", "湖水蓝", "#45AFC5"],
  ["C03", "牛仔蓝", "#4F78A8"],
  ["C04", "午夜蓝", "#354762"],
  ["D01", "薄荷绿", "#91D2B3"],
  ["D02", "草地绿", "#59AE72"],
  ["D03", "森林绿", "#397357"],
  ["D04", "青柠绿", "#A9CF57"],
  ["E01", "燕麦色", "#E6CFAB"],
  ["E02", "焦糖色", "#BC8559"],
  ["E03", "可可棕", "#765342"],
  ["E04", "深咖啡", "#453832"],
  ["N01", "雾灰", "#C8C9C5"],
  ["N02", "石板灰", "#858A8D"],
  ["N03", "炭黑", "#343638"],
  ["P01", "薰衣草", "#C5AEDB"],
  ["P02", "冰蓝", "#B8DCE3"],
  ["P03", "嫩芽绿", "#CAE0A5"],
  ["P04", "腮红粉", "#F2D1D3"],
  ["P05", "纯白", "#FFFFFF"],
];

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToLab([r8, g8, b8]: [number, number, number]): [number, number, number] {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel > 0.04045
      ? Math.pow((channel + 0.055) / 1.055, 2.4)
      : channel / 12.92;
  };
  const r = linear(r8);
  const g = linear(g8);
  const b = linear(b8);
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const pivot = (value: number) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  x = pivot(x);
  y = pivot(y);
  z = pivot(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const PALETTE: PaletteColor[] = PALETTE_SOURCE.map(([code, name, hex]) => {
  const rgb = hexToRgb(hex);
  return { code, name, hex, rgb, lab: rgbToLab(rgb) };
});

function nearestColor(rgb: [number, number, number], indexes: number[]) {
  const lab = rgbToLab(rgb);
  let best = indexes[0] ?? 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const index of indexes) {
    const target = PALETTE[index].lab;
    const distance =
      Math.pow(lab[0] - target[0], 2) +
      Math.pow(lab[1] - target[1], 2) +
      Math.pow(lab[2] - target[2], 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function colorDistance(lab: [number, number, number], paletteIndex: number) {
  const target = PALETTE[paletteIndex].lab;
  return (
    Math.pow(lab[0] - target[0], 2) +
    Math.pow(lab[1] - target[1], 2) +
    Math.pow(lab[2] - target[2], 2)
  );
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function tuneRgb(rgb: [number, number, number], mode: Mode): [number, number, number] {
  const luma = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
  const saturation = mode === "simple" ? 1.25 : mode === "blocks" ? 1.16 : 1.06;
  const contrast = mode === "simple" ? 1.15 : mode === "blocks" ? 1.11 : 1.06;
  const brightness = mode === "detail" ? 3 : 0;
  const step = mode === "simple" ? 24 : mode === "blocks" ? 12 : 1;
  const tuned = rgb.map((channel) => {
    const saturated = luma + (channel - luma) * saturation;
    const contrasted = 128 + (saturated - 128) * contrast + brightness;
    const value = step > 1 ? Math.round(contrasted / step) * step : contrasted;
    return clampChannel(value);
  });
  return tuned as [number, number, number];
}

function simplifySamples(
  samples: Array<[number, number, number] | null>,
  width: number,
  height: number,
  mode: Mode,
) {
  const passes = mode === "simple" ? 2 : mode === "blocks" ? 1 : 0;
  if (!passes) return samples;
  const threshold = mode === "simple" ? 88 : 58;
  let current = samples;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [...current];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const center = current[index];
        if (!center) continue;
        const total = [...center] as [number, number, number];
        let weight = 1;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (!ox && !oy) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const neighbor = current[ny * width + nx];
            if (!neighbor) continue;
            const distance = Math.sqrt(
              Math.pow(center[0] - neighbor[0], 2) +
              Math.pow(center[1] - neighbor[1], 2) +
              Math.pow(center[2] - neighbor[2], 2),
            );
            if (distance > threshold) continue;
            total[0] += neighbor[0];
            total[1] += neighbor[1];
            total[2] += neighbor[2];
            weight += 1;
          }
        }
        next[index] = [
          clampChannel(total[0] / weight),
          clampChannel(total[1] / weight),
          clampChannel(total[2] / weight),
        ];
      }
    }
    current = next;
  }
  return current;
}

function choosePreferredColors(
  samples: Array<[number, number, number] | null>,
  available: number[],
  limit: number,
  mode: Mode,
) {
  const amount = Math.min(limit, available.length);
  if (amount >= available.length) return [...available];

  const frequency = new Map<number, number>();
  for (const rgb of samples) {
    if (!rgb) continue;
    const nearest = nearestColor(rgb, available);
    frequency.set(nearest, (frequency.get(nearest) ?? 0) + 1);
  }

  if (mode !== "detail") {
    return [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, amount)
      .map(([index]) => index);
  }

  const weightedSamples = samples.flatMap((rgb) => {
    if (!rgb) return [];
    const lab = rgbToLab(rgb);
    const chroma = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
    return [{ lab, weight: 1 + Math.min(1, chroma / 65) * 0.75 }];
  });
  if (!weightedSamples.length) return available.slice(0, amount);

  const chosen: number[] = [];
  const bestErrors = new Array(weightedSamples.length).fill(Number.POSITIVE_INFINITY);
  while (chosen.length < amount) {
    let bestCandidate = -1;
    let bestScore = chosen.length ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    for (const candidate of available) {
      if (chosen.includes(candidate)) continue;
      let score = 0;
      for (let i = 0; i < weightedSamples.length; i += 1) {
        const distance = colorDistance(weightedSamples[i].lab, candidate);
        score += chosen.length
          ? Math.max(0, bestErrors[i] - distance) * weightedSamples[i].weight
          : distance * weightedSamples[i].weight;
      }
      const isBetter = chosen.length ? score > bestScore : score < bestScore;
      if (isBetter) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
    if (bestCandidate < 0) break;
    chosen.push(bestCandidate);
    for (let i = 0; i < weightedSamples.length; i += 1) {
      bestErrors[i] = Math.min(bestErrors[i], colorDistance(weightedSamples[i].lab, bestCandidate));
    }
  }
  return chosen.length ? chosen : available.slice(0, amount);
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

function makeDemo() {
  const width = 20;
  const height = 20;
  const cells = new Array(width * height).fill(EMPTY);
  const red = PALETTE.findIndex((color) => color.code === "A06");
  const pink = PALETTE.findIndex((color) => color.code === "A05");
  const green = PALETTE.findIndex((color) => color.code === "D03");
  const light = PALETTE.findIndex((color) => color.code === "D02");
  const seed = PALETTE.findIndex((color) => color.code === "A02");
  const set = (x: number, y: number, color: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) cells[y * width + x] = color;
  };
  for (let y = 5; y < 17; y += 1) {
    const inset = Math.floor(Math.max(0, y - 11) / 2);
    for (let x = 3 + inset; x < 17 - inset; x += 1) set(x, y, y < 8 ? pink : red);
  }
  for (let x = 7; x <= 12; x += 1) set(x, 4, green);
  set(6, 3, light); set(7, 3, green); set(12, 3, green); set(13, 3, light);
  set(8, 2, green); set(11, 2, green); set(9, 3, light); set(10, 3, light);
  [[6, 8], [10, 7], [14, 9], [8, 11], [12, 12], [9, 15]].forEach(([x, y]) => set(x, y, seed));
  return { width, height, cells };
}

function resizePattern(cells: BeadCell[], width: number, height: number, nextWidth: number) {
  const nextHeight = Math.max(12, Math.min(80, Math.round(nextWidth * height / width)));
  const resized = new Array(nextWidth * nextHeight).fill(EMPTY);
  for (let y = 0; y < nextHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) * height / nextHeight));
    for (let x = 0; x < nextWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x + 0.5) * width / nextWidth));
      resized[y * nextWidth + x] = cells[sourceY * width + sourceX] ?? EMPTY;
    }
  }
  return { width: nextWidth, height: nextHeight, cells: resized };
}

function displayCellSize(width: number) {
  return width <= 32 ? 23 : width <= 58 ? 16 : 12;
}

export function BeadStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef(false);
  const gestureRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean; pointerType: string } | null>(null);
  const processRequestRef = useRef(0);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceName, setSourceName] = useState("我的拼豆");
  const [imageRevision, setImageRevision] = useState(0);
  const [gridWidth, setGridWidth] = useState(29);
  const [gridHeight, setGridHeight] = useState(29);
  const [mode, setMode] = useState<Mode>("blocks");
  const [maxColors, setMaxColors] = useState(12);
  const [cleanup, setCleanup] = useState(45);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const [cropZoom, setCropZoom] = useState(100);
  const [focusX, setFocusX] = useState(50);
  const [focusY, setFocusY] = useState(50);
  const [cells, setCells] = useState<BeadCell[]>([]);
  const [history, setHistory] = useState<BeadCell[][]>([]);
  const [future, setFuture] = useState<BeadCell[][]>([]);
  const [selectedColor, setSelectedColor] = useState(4);
  const [activeColors, setActiveColors] = useState<number[]>(PALETTE.map((_, i) => i));
  const [tool, setTool] = useState<Tool>("paint");
  const [showCodes, setShowCodes] = useState(false);
  const [roundBeads, setRoundBeads] = useState(true);
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("view");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("canvas");
  const [compare, setCompare] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState("");

  const hasPattern = cells.length > 0;

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const processImage = useCallback(() => {
    const image = imageRef.current;
    if (!image || !image.naturalWidth || activeColors.length === 0) return;
    const requestId = ++processRequestRef.current;
    const width = gridWidth;
    const height = gridHeight;
    setProcessing(true);
    window.setTimeout(() => {
      if (requestId !== processRequestRef.current) return;
      try {
        const offscreen = document.createElement("canvas");
        offscreen.width = width;
        offscreen.height = height;
        const context = offscreen.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("canvas");
        context.clearRect(0, 0, width, height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = mode === "detail" ? "high" : "medium";

        const sourceRatio = image.naturalWidth / image.naturalHeight;
        const targetRatio = width / height;
        let sx = 0;
        let sy = 0;
        let sw = image.naturalWidth;
        let sh = image.naturalHeight;
        let dx = 0;
        let dy = 0;
        let dw = width;
        let dh = height;

        if (fit === "cover") {
          if (sourceRatio > targetRatio) {
            sw = image.naturalHeight * targetRatio;
          } else {
            sh = image.naturalWidth / targetRatio;
          }
          const zoom = cropZoom / 100;
          sw /= zoom;
          sh /= zoom;
          sx = (image.naturalWidth - sw) * focusX / 100;
          sy = (image.naturalHeight - sh) * focusY / 100;
        } else if (sourceRatio > targetRatio) {
          dh = width / sourceRatio;
          dy = (height - dh) / 2;
        } else {
          dw = height * sourceRatio;
          dx = (width - dw) / 2;
        }

        context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
        const data = context.getImageData(0, 0, width, height).data;
        const sourceSamples: Array<[number, number, number] | null> = [];
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            const offset = index * 4;
            if (data[offset + 3] < 42) {
              sourceSamples.push(null);
              continue;
            }
            sourceSamples.push([data[offset], data[offset + 1], data[offset + 2]]);
          }
        }

        const rawRgb = simplifySamples(sourceSamples, width, height, mode)
          .map((rgb) => rgb ? tuneRgb(rgb, mode) : null);

        const preferred = choosePreferredColors(rawRgb, activeColors, maxColors, mode);
        let result = rawRgb.map((rgb) => (rgb ? nearestColor(rgb, preferred) : EMPTY));

        const passes = mode === "detail"
          ? (cleanup > 70 ? 1 : 0)
          : cleanup > 72 ? 2 : cleanup > 20 ? 1 : 0;
        for (let pass = 0; pass < passes; pass += 1) {
          const next = [...result];
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const index = y * width + x;
              if (result[index] === EMPTY) continue;
              const neighbors: number[] = [];
              [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([ox, oy]) => {
                const nx = x + ox;
                const ny = y + oy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  const value = result[ny * width + nx];
                  if (value !== EMPTY) neighbors.push(value);
                }
              });
              const same = neighbors.filter((value) => value === result[index]).length;
              const counts = new Map<number, number>();
              neighbors.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
              const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
              const threshold = cleanup > 72 ? 2 : 1;
              if (dominant && same <= threshold && dominant[1] >= 3) next[index] = dominant[0];
            }
          }
          result = next;
        }

        if (requestId !== processRequestRef.current) return;
        setCells(result);
        setHistory([]);
        setFuture([]);
        setProcessing(false);
        setCompare(false);
      } catch {
        if (requestId !== processRequestRef.current) return;
        setProcessing(false);
        notify("这张图片暂时没有处理成功，请换个设置再试");
      }
    }, 20);
  }, [activeColors, cleanup, cropZoom, fit, focusX, focusY, gridHeight, gridWidth, maxColors, mode, notify]);

  useEffect(() => {
    processRequestRef.current += 1;
    if (!sourceUrl) {
      imageRef.current = null;
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setImageRevision((value) => value + 1);
    };
    image.onerror = () => {
      if (cancelled) return;
      setProcessing(false);
      notify("这张图片没有读取成功，请重新选择");
    };
    image.src = sourceUrl;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      processRequestRef.current += 1;
    };
  }, [notify, sourceUrl]);

  useEffect(() => {
    const image = imageRef.current;
    if (!sourceUrl || !image?.naturalWidth) return;
    const nextHeight = Math.max(12, Math.min(80, Math.round(gridWidth * image.naturalHeight / image.naturalWidth)));
    setGridHeight(nextHeight);
  }, [gridWidth, imageRevision, sourceUrl]);

  useEffect(() => {
    if (sourceUrl && imageRef.current) processImage();
  }, [imageRevision, processImage, sourceUrl]);

  const drawPattern = useCallback((canvas: HTMLCanvasElement, exportKind?: "preview" | "pattern") => {
    if (!cells.length) return;
    const cellSize = exportKind
      ? (exportKind === "pattern" ? 52 : 34)
      : Math.round(displayCellSize(gridWidth) * canvasZoom / 100);
    const header = exportKind ? 92 : 0;
    canvas.width = gridWidth * cellSize;
    canvas.height = gridHeight * cellSize + header;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = exportKind === "pattern" ? "#fffdf9" : "#fbf5ec";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (header) {
      context.fillStyle = "#3f3a36";
      context.font = "700 28px Arial, sans-serif";
      context.fillText(sourceName, 24, 38);
      context.fillStyle = "#81766d";
      context.font = "18px Arial, sans-serif";
      context.fillText(`${gridWidth} × ${gridHeight} · ${cells.filter((cell) => cell !== EMPTY).length} 颗`, 24, 70);
    }
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        const value = cells[y * gridWidth + x];
        const px = x * cellSize;
        const py = y * cellSize + header;
        const color = value === EMPTY ? undefined : PALETTE[value];
        if (color) {
          context.fillStyle = color.hex;
          if ((exportKind !== "pattern" && roundBeads) || (!exportKind && roundBeads)) {
            context.beginPath();
            context.arc(px + cellSize / 2, py + cellSize / 2, cellSize * 0.43, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = "rgba(255,255,255,.32)";
            context.beginPath();
            context.arc(px + cellSize * 0.38, py + cellSize * 0.35, cellSize * 0.1, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = "rgba(70,55,45,.17)";
            context.beginPath();
            context.arc(px + cellSize / 2, py + cellSize / 2, cellSize * 0.11, 0, Math.PI * 2);
            context.fill();
          } else {
            context.fillRect(px, py, cellSize, cellSize);
          }
        }
        const shouldGrid = exportKind === "pattern" || !exportKind;
        if (shouldGrid) {
          context.strokeStyle = x % 5 === 0 || y % 5 === 0 ? "rgba(97,78,65,.3)" : "rgba(97,78,65,.13)";
          context.lineWidth = x % 5 === 0 || y % 5 === 0 ? 1.2 : 0.6;
          context.strokeRect(px, py, cellSize, cellSize);
        }
        if (color && (exportKind === "pattern" || (showCodes && cellSize >= 16))) {
          const rgb = color.rgb;
          const lightness = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
          context.fillStyle = lightness > 155 ? "#4d443f" : "#fffdf8";
          context.font = `700 ${Math.max(8, Math.floor(cellSize * 0.3))}px Arial, sans-serif`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(color.code, px + cellSize / 2, py + cellSize / 2);
          context.textAlign = "start";
          context.textBaseline = "alphabetic";
        }
      }
    }
  }, [canvasZoom, cells, gridHeight, gridWidth, roundBeads, showCodes, sourceName]);

  useEffect(() => {
    if (!compare && canvasRef.current) drawPattern(canvasRef.current);
  }, [compare, drawPattern]);

  const readFile = async (file: File) => {
    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        const project = JSON.parse(await file.text()) as { width: number; height: number; cells: Array<string | null>; name?: string };
        const imported = project.cells.map((code) => code ? PALETTE.findIndex((color) => color.code === code) : EMPTY);
        if (!project.width || !project.height || imported.some((value, index) => project.cells[index] && value < 0)) throw new Error("invalid");
        setGridWidth(project.width);
        setGridHeight(project.height);
        setCells(imported);
        setSourceName(project.name ?? "导入的拼豆");
        setSourceUrl("");
        setCompare(false);
        setCanvasZoom(100);
        setInteractionMode("view");
        setMobilePanel("canvas");
        setHistory([]);
        setFuture([]);
        notify("项目已经打开啦");
      } catch {
        notify("这个项目文件好像不完整");
      }
      return;
    }
    if (!file.type.startsWith("image/")) {
      notify("请选择 JPG、PNG 或 WebP 图片");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      notify("图片有点大，请选择 15MB 以内的文件");
      return;
    }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setProcessing(true);
    setSourceName(file.name.replace(/\.[^.]+$/, "") || "我的拼豆");
    setSourceUrl(URL.createObjectURL(file));
    setCompare(false);
    setCanvasZoom(100);
    setCropZoom(100);
    setFocusX(50);
    setFocusY(50);
    setInteractionMode("view");
    setMobilePanel("settings");
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
      if (file) void readFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void readFile(file);
    event.target.value = "";
  };

  const pushEdit = (next: BeadCell[]) => {
    setHistory((items) => [...items.slice(-29), cells]);
    setCells(next);
    setFuture([]);
  };

  const editAt = (event: ReactPointerEvent<HTMLCanvasElement>, commit: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas || !cells.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * gridWidth);
    const y = Math.floor((event.clientY - rect.top) / rect.height * gridHeight);
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;
    const index = y * gridWidth + x;
    if (tool === "pick") {
      if (cells[index] !== EMPTY) setSelectedColor(cells[index]);
      setTool("paint");
      return;
    }
    const value = tool === "erase" ? EMPTY : selectedColor;
    if (cells[index] === value) return;
    const next = [...cells];
    next[index] = value;
    if (commit) pushEdit(next);
    else setCells(next);
  };

  const beginCanvasGesture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (interactionMode !== "edit") return;
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      pointerType: event.pointerType,
    };
    drawingRef.current = event.pointerType === "mouse";
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === "mouse") editAt(event, true);
  };

  const moveCanvasGesture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) gesture.moved = true;
    if (drawingRef.current && gesture.pointerType === "mouse") editAt(event, false);
  };

  const endCanvasGesture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (gesture && gesture.pointerId === event.pointerId && gesture.pointerType !== "mouse" && !gesture.moved) {
      editAt(event, true);
    }
    drawingRef.current = false;
    gestureRef.current = null;
  };

  const fitCanvas = () => {
    setCanvasZoom(100);
    window.requestAnimationFrame(() => stageRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" }));
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [cells, ...items].slice(0, 30));
    setCells(previous);
    setHistory((items) => items.slice(0, -1));
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, cells]);
    setCells(next);
    setFuture((items) => items.slice(1));
  };

  const counts = useMemo(() => {
    const map = new Map<number, number>();
    cells.forEach((cell) => {
      if (cell !== EMPTY) map.set(cell, (map.get(cell) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [cells]);

  const exportPng = (kind: "preview" | "pattern") => {
    const canvas = document.createElement("canvas");
    drawPattern(canvas, kind);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${sourceName}-${kind === "preview" ? "拼豆预览" : "拼豆图纸"}.png`);
    }, "image/png");
    notify(kind === "preview" ? "预览图已经下载" : "施工图已经下载");
  };

  const exportProject = () => {
    const project = {
      version: 1,
      name: sourceName,
      width: gridWidth,
      height: gridHeight,
      palette: "豆豆画室趣味色板-v1",
      cells: cells.map((cell) => cell === EMPTY ? null : PALETTE[cell].code),
    };
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), `${sourceName}.beads.json`);
    notify("项目已经保存");
  };

  const loadDemo = () => {
    const demo = makeDemo();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    imageRef.current = null;
    setGridWidth(demo.width);
    setGridHeight(demo.height);
    setCells(demo.cells);
    setSourceName("小草莓");
    setSourceUrl("");
    setCompare(false);
    setCanvasZoom(100);
    setInteractionMode("view");
    setMobilePanel("canvas");
    setHistory([]);
    setFuture([]);
  };

  const changeGridWidth = (nextValue: number) => {
    const nextWidth = Math.max(12, Math.min(80, nextValue));
    if (!sourceUrl && cells.length === gridWidth * gridHeight) {
      const resized = resizePattern(cells, gridWidth, gridHeight, nextWidth);
      setGridWidth(resized.width);
      setGridHeight(resized.height);
      setCells(resized.cells);
      setHistory([]);
      setFuture([]);
      return;
    }
    setGridWidth(nextWidth);
  };

  const togglePalette = (index: number) => {
    if (activeColors.includes(index)) {
      if (activeColors.length <= 4) return notify("至少保留 4 种颜色哦");
      setActiveColors(activeColors.filter((item) => item !== index));
    } else {
      setActiveColors([...activeColors, index]);
    }
  };

  const applyMode = (nextMode: Mode) => {
    setMode(nextMode);
    if (nextMode === "simple") {
      setMaxColors((value) => Math.min(12, value));
      setCleanup(82);
      notify("极简图案：合并纹理和零碎色块");
    } else if (nextMode === "blocks") {
      setMaxColors((value) => Math.max(12, Math.min(18, value)));
      setCleanup(55);
      notify("色块清晰：突出主体和主要轮廓");
    } else {
      changeGridWidth(Math.max(40, gridWidth));
      setMaxColors((value) => Math.max(18, value));
      setCleanup(25);
      notify("保留细节：适合 40 格以上的照片");
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void readFile(file);
  };

  return (
    <main
      className={`app-shell ${dragging ? "is-dragging" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <TencentRum />
      <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,.json" onChange={handleInput} />
      <header className="topbar">
        <button className="brand" type="button" onClick={() => window.location.reload()} aria-label="返回首页">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span><b>豆豆画室</b><small>把喜欢的图片，变成小小拼豆</small></span>
        </button>
        <span className="privacy-pill"><span>♥</span> 图片只在设备里处理</span>
      </header>

      {!hasPattern ? (
        <section className="welcome">
          <div className="welcome-copy">
            <span className="eyebrow">一个朋友间分享的拼豆小玩具</span>
            <h1>丢进一张图片，<br />看看它变成拼豆的样子。</h1>
            <p>头像、宠物、动漫角色或表情包都可以。不用登录，打开就能玩。</p>
            <div className="welcome-actions">
              <button className="button primary large" type="button" onClick={() => inputRef.current?.click()}>
                <span>＋</span> 选择一张图片
              </button>
              <button className="button soft large" type="button" onClick={loadDemo}>先玩小草莓</button>
            </div>
            <p className="paste-tip">也可以直接拖进来，或按 Ctrl + V 粘贴图片</p>
          </div>
          <button className="drop-card" type="button" onClick={() => inputRef.current?.click()}>
            <span className="bead-art" aria-hidden="true">
              {Array.from({ length: 49 }).map((_, index) => <i key={index} />)}
            </span>
            <b>把图片放在这里</b>
            <small>JPG · PNG · WebP · 15MB以内</small>
          </button>
        </section>
      ) : (
        <section className={`studio mobile-${mobilePanel}`}>
          <aside className="panel settings-panel">
            <div className="panel-heading">
              <div><span className="step">01</span><h2>选个效果</h2></div>
              <button className="text-button" type="button" onClick={() => inputRef.current?.click()}>换图片</button>
            </div>

            {sourceUrl && (
              <div className="crop-preview" aria-label="当前取景预览">
                <img
                  src={sourceUrl}
                  alt="上传的原图"
                  style={{ objectPosition: `${focusX}% ${focusY}%`, transform: `scale(${cropZoom / 100})` }}
                />
                <span>取景预览</span>
              </div>
            )}

            <div className="field-group">
              <label>照片简化方式</label>
              <div className="mode-grid">
                {([
                  ["detail", "◉", "保留细节", "40 格以上"],
                  ["blocks", "✦", "色块清晰", "推荐"],
                  ["simple", "▦", "极简图案", "小工程"],
                ] as const).map(([value, icon, title, desc]) => (
                  <button key={value} className={mode === value ? "mode active" : "mode"} type="button" onClick={() => applyMode(value)}>
                    <span>{icon}</span><b>{title}</b><small>{desc}</small>
                  </button>
                ))}
              </div>
              <small className="mode-tip">
                {mode === "detail" ? "保留较多明暗和颜色，人物照片建议 40～58 格。" : mode === "blocks" ? "先平滑纹理，再保留主体轮廓，适合大多数照片。" : "强力合并背景纹理和零碎颜色，适合 20～29 格。"}
              </small>
            </div>

            {sourceUrl && (
              <div className="field-group crop-controls">
                <label>裁剪并突出主体 <output>{cropZoom}%</output></label>
                <input aria-label="放大主体" type="range" min="100" max="200" step="10" value={cropZoom} onChange={(event) => setCropZoom(Number(event.target.value))} disabled={fit === "contain"} />
                <div className="focus-grid" aria-label="主体位置">
                  {[0, 50, 100].flatMap((y) => [0, 50, 100].map((x) => (
                    <button
                      key={`${x}-${y}`}
                      type="button"
                      aria-label={`主体位置 ${x}-${y}`}
                      className={focusX === x && focusY === y ? "active" : ""}
                      onClick={() => { setFit("cover"); setFocusX(x); setFocusY(y); }}
                    />
                  )))}
                </div>
                <small className="mode-tip">先放大并把人物或主体移到合适位置，通常比增加豆子更有效。</small>
              </div>
            )}

            <div className="field-group">
              <label>图纸宽度 <output>{gridWidth} 格</output></label>
              <div className="size-pills">
                {[20, 29, 40, 58].map((size) => <button key={size} type="button" className={gridWidth === size ? "active" : ""} onClick={() => changeGridWidth(size)}>{size}</button>)}
              </div>
              <input aria-label="自定义图纸宽度" type="range" min="12" max="80" value={gridWidth} onChange={(event) => changeGridWidth(Number(event.target.value))} />
              <small className="field-help">当前约 {gridWidth} × {gridHeight} 格</small>
            </div>

            <div className="field-group split-fields">
              <label>颜色数量
                <select value={maxColors} onChange={(event) => setMaxColors(Number(event.target.value))}>
                  {[8, 12, 18, 24, 30].map((amount) => <option key={amount} value={amount}>{amount} 色</option>)}
                </select>
              </label>
              <label>取景方式
                <select value={fit} onChange={(event) => setFit(event.target.value as "cover" | "contain")}>
                  <option value="cover">铺满画面</option>
                  <option value="contain">保留全图</option>
                </select>
              </label>
            </div>

            <div className="field-group">
              <label>清理零碎颜色 <output>{cleanup}%</output></label>
              <input type="range" min="0" max="100" value={cleanup} onChange={(event) => setCleanup(Number(event.target.value))} />
            </div>

            <details className="palette-details">
              <summary>可用颜色 <span>{activeColors.length}/{PALETTE.length}</span></summary>
              <p>点一下可以排除手里没有的颜色。</p>
              <div className="palette-toggle-grid">
                {PALETTE.map((color, index) => (
                  <button key={color.code} type="button" title={`${color.code} ${color.name}`} className={activeColors.includes(index) ? "" : "disabled"} style={{ "--swatch": color.hex } as CSSProperties} onClick={() => togglePalette(index)}>
                    <i /> <small>{color.code}</small>
                  </button>
                ))}
              </div>
              <small className="palette-note">色彩以屏幕近似效果展示，制作前建议与实物色卡确认。</small>
            </details>
          </aside>

          <section className="workspace">
            <div className="workspace-toolbar">
              <div className="tool-group" aria-label="查看或编辑图纸">
                <div className="interaction-toggle">
                  <button type="button" className={interactionMode === "view" ? "active" : ""} onClick={() => setInteractionMode("view")}>☝ <span>移动</span></button>
                  <button type="button" className={interactionMode === "edit" ? "active" : ""} onClick={() => setInteractionMode("edit")}>✎ <span>编辑</span></button>
                </div>
                {interactionMode === "edit" && (
                  <div className="edit-tools">
                    <button type="button" className={tool === "paint" ? "active" : ""} onClick={() => setTool("paint")} title="画笔">● <span>换色</span></button>
                    <button type="button" className={tool === "erase" ? "active" : ""} onClick={() => setTool("erase")} title="橡皮">◇ <span>擦除</span></button>
                    <button type="button" className={tool === "pick" ? "active" : ""} onClick={() => setTool("pick")} title="吸色">◎ <span>吸色</span></button>
                  </div>
                )}
              </div>
              <div className="tool-group compact">
                <button type="button" disabled={!history.length} onClick={undo} title="撤销">↶</button>
                <button type="button" disabled={!future.length} onClick={redo} title="重做">↷</button>
                <div className="zoom-control" aria-label="图纸缩放">
                  <button type="button" aria-label="适应屏幕" disabled={compare} onClick={fitCanvas}>适应</button>
                  <button type="button" aria-label="缩小图纸" disabled={compare || canvasZoom <= 100} onClick={() => setCanvasZoom((value) => Math.max(100, value - 25))}>−</button>
                  <output aria-label="当前图纸缩放">{canvasZoom}%</output>
                  <button type="button" aria-label="放大图纸" disabled={compare || canvasZoom >= 250} onClick={() => setCanvasZoom((value) => Math.min(250, value + 25))}>＋</button>
                </div>
                {sourceUrl && <button type="button" className={compare ? "active" : ""} onClick={() => setCompare(!compare)}>{compare ? "看豆图" : "看原图"}</button>}
              </div>
            </div>

            <div ref={stageRef} className={`canvas-stage ${interactionMode === "view" ? "is-viewing" : "is-editing"}`}>
              {processing && <div className="processing"><span /><b>正在撒豆豆…</b></div>}
              <div className="canvas-content">
                {compare && sourceUrl ? (
                  <img className="compare-image" src={sourceUrl} alt="原图对比" />
                ) : (
                  <canvas
                    ref={canvasRef}
                    className={`pattern-canvas ${canvasZoom > 100 ? "is-zoomed" : ""} ${interactionMode === "view" ? "view-only" : "editable"}`}
                    aria-label={interactionMode === "view" ? "拼豆图纸，当前为移动查看模式" : "可点击修改的拼豆图纸"}
                    onPointerDown={beginCanvasGesture}
                    onPointerMove={moveCanvasGesture}
                    onPointerUp={endCanvasGesture}
                    onPointerCancel={(event) => endCanvasGesture(event)}
                  />
                )}
              </div>
            </div>

            <div className="canvas-footer">
              <div className="selected-color">
                <span style={{ background: PALETTE[selectedColor]?.hex }} />
                <div><small>当前颜色</small><b>{PALETTE[selectedColor]?.code} · {PALETTE[selectedColor]?.name}</b></div>
              </div>
              <div className="view-toggles">
                <label><input type="checkbox" checked={showCodes} onChange={(event) => {
                  const checked = event.target.checked;
                  setShowCodes(checked);
                  if (checked) {
                    setCanvasZoom((value) => Math.max(150, value));
                    setInteractionMode("view");
                  }
                }} /> 色号</label>
                <label><input type="checkbox" checked={roundBeads} onChange={(event) => setRoundBeads(event.target.checked)} /> 圆豆</label>
              </div>
            </div>

            <div className={`quick-palette ${interactionMode === "edit" ? "is-open" : ""}`} aria-label="画笔颜色">
              {counts.slice(0, 16).map(([index]) => (
                <button key={index} type="button" title={`${PALETTE[index].code} ${PALETTE[index].name}`} className={selectedColor === index ? "active" : ""} style={{ "--swatch": PALETTE[index].hex } as CSSProperties} onClick={() => { setSelectedColor(index); setTool("paint"); }} />
              ))}
            </div>
          </section>

          <aside className="panel export-panel">
            <div className="panel-heading"><div><span className="step">02</span><h2>准备开拼</h2></div></div>
            <div className="project-summary">
              <label>作品名字<input value={sourceName} onChange={(event) => setSourceName(event.target.value)} /></label>
              <div><span><b>{gridWidth} × {gridHeight}</b><small>图纸大小</small></span><span><b>{cells.filter((cell) => cell !== EMPTY).length}</b><small>豆豆总数</small></span></div>
            </div>
            <div className="material-heading"><b>用色清单</b><span>{counts.length} 种颜色</span></div>
            <div className="material-list">
              {counts.map(([index, amount]) => (
                <button key={index} type="button" className={selectedColor === index ? "active" : ""} onClick={() => { setSelectedColor(index); setTool("paint"); }}>
                  <i style={{ background: PALETTE[index].hex }} /><span><b>{PALETTE[index].code}</b><small>{PALETTE[index].name}</small></span><strong>{amount}<small> 颗</small></strong>
                </button>
              ))}
            </div>
            <div className="export-actions">
              <button className="button primary" type="button" onClick={() => exportPng("preview")}>下载好看预览图</button>
              <button className="button soft" type="button" onClick={() => exportPng("pattern")}>下载带色号图纸</button>
              <button className="text-button save-project" type="button" onClick={exportProject}>保存项目，下次继续</button>
            </div>
          </aside>

          <nav className="mobile-studio-nav" aria-label="手机端操作步骤">
            <button type="button" className={mobilePanel === "settings" ? "active" : ""} onClick={() => setMobilePanel("settings")}><span>1</span>图片效果</button>
            <button type="button" className={mobilePanel === "canvas" ? "active" : ""} onClick={() => setMobilePanel("canvas")}><span>2</span>拼豆图纸</button>
            <button type="button" className={mobilePanel === "export" ? "active" : ""} onClick={() => setMobilePanel("export")}><span>3</span>用色下载</button>
          </nav>
        </section>
      )}

      <footer><span>豆豆画室 · 为了快乐而做</span><span>图片不上传 · 仅记录匿名访问量</span></footer>
      {dragging && <div className="drop-overlay"><div><span>＋</span><b>松手就开始变豆豆</b></div></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
