"use client";

import {
  MouseEvent,
  TouchEvent,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";

import { ImageResource } from "../utils/image-resources";
import { showToast } from "./ui-lib";

import styles from "./image-preview.module.scss";

interface ImageSaverPlugin {
  saveImage(options: {
    source: string;
    fileName: string;
    mimeType: string;
  }): Promise<{ uri: string }>;
  copyImage(options: {
    source: string;
    fileName: string;
    mimeType: string;
  }): Promise<{ uri: string }>;
}

const ImageSaver = registerPlugin<ImageSaverPlugin>("ImageSaver");

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function formatFileTime(date: Date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function getImageExtension(image: string) {
  const mime = image.match(/^data:(image\/[^;]+);base64,/)?.[1];
  if (mime) {
    if (
      mime.includes("jpeg") ||
      mime.includes("jpg") ||
      mime.includes("jfif")
    ) {
      return "jpg";
    }
    if (mime.includes("webp")) return "webp";
    if (mime.includes("gif")) return "gif";
    return "png";
  }

  const cleanUrl = image.split("?")[0] ?? "";
  const ext = cleanUrl.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  if (ext === "jpeg" || ext === "jpg" || ext === "jfif") return "jpg";
  if (ext === "webp" || ext === "gif" || ext === "png") return ext;

  return "png";
}

function getImageMimeType(image: string) {
  const mime = image.match(/^data:(image\/[^;]+);base64,/)?.[1];
  if (mime) return mime;

  const ext = getImageExtension(image);
  if (ext === "jpg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

function getImageFileName(resource: ImageResource) {
  const ext = getImageExtension(resource.image);
  return `image-${formatFileTime(new Date(resource.createdAt))}-${
    resource.imageIndex + 1
  }.${ext}`;
}

async function getImageBlob(image: string) {
  if (image.startsWith("data:")) {
    const [header, data = ""] = image.split(",");
    const mimeType = header.match(/^data:([^;]+);base64$/)?.[1] ?? "image/png";
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }

  const response = await fetch(image);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  return response.blob();
}

async function convertBlobToPng(blob: Blob) {
  if (blob.type === "image/png") return blob;

  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");

  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((pngBlob) => {
      if (pngBlob) {
        resolve(pngBlob);
      } else {
        reject(new Error("Failed to convert image"));
      }
    }, "image/png");
  });
}

export async function copyImage(resource: ImageResource) {
  if (Capacitor.isNativePlatform()) {
    try {
      await ImageSaver.copyImage({
        source: resource.image,
        fileName: getImageFileName(resource),
        mimeType: getImageMimeType(resource.image),
      });
      showToast("已复制图片");
      return;
    } catch (error) {
      console.warn("[ImagePreview] native image copy failed", error);
      showToast("复制失败");
      return;
    }
  }

  try {
    const blob = await convertBlobToPng(await getImageBlob(resource.image));
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob,
      }),
    ]);
    showToast("已复制图片");
  } catch (error) {
    console.warn("[ImagePreview] web image copy failed", error);
    showToast("复制失败");
  }
}

export async function downloadImage(resource: ImageResource) {
  const fileName = getImageFileName(resource);

  if (Capacitor.isNativePlatform()) {
    try {
      await ImageSaver.saveImage({
        source: resource.image,
        fileName,
        mimeType: getImageMimeType(resource.image),
      });
      showToast("已保存到相册");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存失败");
    }
    return;
  }

  const link = document.createElement("a");
  link.href = resource.image;
  link.download = fileName;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function getTouchDistance(touches: React.TouchList) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function getTouchCenter(touches: React.TouchList) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function clampScale(value: number) {
  return Math.min(Math.max(value, 1), 5);
}

export function ImagePreviewModal(props: {
  resource: ImageResource;
  resources?: ImageResource[];
  currentResourceId?: string;
  onClose: () => void;
  onSelect?: (resource: ImageResource) => void;
  onDelete: (resource: ImageResource) => void;
}) {
  const resources = props.resources ?? [props.resource];
  const currentResourceId = props.currentResourceId ?? props.resource.id;
  const currentIndex = useMemo(
    () => resources.findIndex((resource) => resource.id === currentResourceId),
    [currentResourceId, resources],
  );
  const currentResource =
    currentIndex >= 0 ? resources[currentIndex] : props.resource;
  const previousResource =
    currentIndex > 0 ? resources[currentIndex - 1] : undefined;
  const nextResource =
    currentIndex >= 0 && currentIndex < resources.length - 1
      ? resources[currentIndex + 1]
      : undefined;
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [isTouching, setIsTouching] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const transformRef = useRef(transform);
  const pendingTransformRef = useRef(transform);
  const transformFrameRef = useRef<number>();
  const singleClickTimerRef = useRef<number | undefined>(undefined);
  const suppressNextClickRef = useRef(false);
  const gestureRef = useRef<{
    mode: "none" | "pan" | "pinch";
    startScale: number;
    startX: number;
    startY: number;
    startDistance: number;
    startCenterX: number;
    startCenterY: number;
    touchX: number;
    touchY: number;
  }>({
    mode: "none",
    startScale: 1,
    startX: 0,
    startY: 0,
    startDistance: 0,
    startCenterX: 0,
    startCenterY: 0,
    touchX: 0,
    touchY: 0,
  });

  useEffect(() => {
    transformRef.current = transform;
    pendingTransformRef.current = transform;
  }, [transform]);

  const applyTransform = useCallback((nextTransform: typeof transform) => {
    transformRef.current = nextTransform;
    pendingTransformRef.current = nextTransform;

    if (transformFrameRef.current !== undefined) return;

    transformFrameRef.current = window.requestAnimationFrame(() => {
      transformFrameRef.current = undefined;
      setTransform(pendingTransformRef.current);
    });
  }, []);

  const updateImageSize = useCallback(() => {
    const image = imageRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const isCompact = viewportWidth <= 600;
    const horizontalPadding = isCompact ? 36 : 56;
    const topPadding = isCompact ? 18 : 24;
    const bottomPadding = isCompact ? 18 : 24;
    const actionSpace = isCompact ? 62 : 68;
    const maxWidth = Math.max(1, viewportWidth - horizontalPadding);
    const maxHeight = Math.max(
      1,
      viewportHeight - topPadding - bottomPadding - actionSpace,
    );
    const scale = Math.min(
      maxWidth / image.naturalWidth,
      maxHeight / image.naturalHeight,
    );

    setImageSize({
      width: Math.max(1, Math.round(image.naturalWidth * scale)),
      height: Math.max(1, Math.round(image.naturalHeight * scale)),
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      } else if (event.key === "ArrowLeft" && previousResource) {
        props.onSelect?.(previousResource);
      } else if (event.key === "ArrowRight" && nextResource) {
        props.onSelect?.(nextResource);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextResource, previousResource, props]);

  useEffect(() => {
    const resetTransform = { scale: 1, x: 0, y: 0 };
    transformRef.current = resetTransform;
    pendingTransformRef.current = resetTransform;
    setTransform(resetTransform);
    setIsTouching(false);
    setImageSize({ width: 0, height: 0 });
    requestAnimationFrame(updateImageSize);
  }, [currentResource.id, updateImageSize]);

  useEffect(() => {
    window.addEventListener("resize", updateImageSize);
    window.visualViewport?.addEventListener("resize", updateImageSize);
    return () => {
      window.removeEventListener("resize", updateImageSize);
      window.visualViewport?.removeEventListener("resize", updateImageSize);
      if (singleClickTimerRef.current) {
        window.clearTimeout(singleClickTimerRef.current);
      }
      if (transformFrameRef.current !== undefined) {
        window.cancelAnimationFrame(transformFrameRef.current);
      }
    };
  }, [updateImageSize]);

  function stopPreviewClick(event: MouseEvent) {
    event.stopPropagation();
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    event.stopPropagation();
    suppressNextClickRef.current = false;
    const currentTransform = transformRef.current;

    if (event.touches.length === 2) {
      suppressNextClickRef.current = true;
      const center = getTouchCenter(event.touches);
      const stageRect = stageRef.current?.getBoundingClientRect();
      const relativeCenter = stageRect
        ? {
            x: center.x - stageRect.left - stageRect.width / 2,
            y: center.y - stageRect.top - stageRect.height / 2,
          }
        : center;
      setIsTouching(true);
      gestureRef.current = {
        mode: "pinch",
        startScale: currentTransform.scale,
        startX: currentTransform.x,
        startY: currentTransform.y,
        startDistance: getTouchDistance(event.touches),
        startCenterX: relativeCenter.x,
        startCenterY: relativeCenter.y,
        touchX: 0,
        touchY: 0,
      };
      return;
    }

    if (event.touches.length === 1 && currentTransform.scale > 1) {
      setIsTouching(true);
      gestureRef.current = {
        ...gestureRef.current,
        mode: "pan",
        startX: currentTransform.x,
        startY: currentTransform.y,
        touchX: event.touches[0].clientX,
        touchY: event.touches[0].clientY,
      };
    }
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (gesture.mode === "none") return;

    suppressNextClickRef.current = true;
    event.preventDefault();
    event.stopPropagation();

    if (gesture.mode === "pinch" && event.touches.length === 2) {
      const nextScale = clampScale(
        gesture.startScale *
          (getTouchDistance(event.touches) / gesture.startDistance),
      );
      const center = getTouchCenter(event.touches);
      const stageRect = stageRef.current?.getBoundingClientRect();
      const relativeCenter = stageRect
        ? {
            x: center.x - stageRect.left - stageRect.width / 2,
            y: center.y - stageRect.top - stageRect.height / 2,
          }
        : center;
      applyTransform({
        scale: nextScale,
        x:
          relativeCenter.x -
          ((gesture.startCenterX - gesture.startX) / gesture.startScale) *
            nextScale,
        y:
          relativeCenter.y -
          ((gesture.startCenterY - gesture.startY) / gesture.startScale) *
            nextScale,
      });
      return;
    }

    if (gesture.mode === "pan" && event.touches.length === 1) {
      applyTransform({
        scale: transformRef.current.scale,
        x: gesture.startX + event.touches[0].clientX - gesture.touchX,
        y: gesture.startY + event.touches[0].clientY - gesture.touchY,
      });
    }
  }

  function onTouchEnd() {
    gestureRef.current.mode = "none";
    setIsTouching(false);
    const currentTransform = transformRef.current;
    applyTransform(
      currentTransform.scale <= 1.02
        ? { scale: 1, x: 0, y: 0 }
        : currentTransform,
    );
  }

  function toggleZoom(event: MouseEvent<HTMLImageElement>) {
    event.stopPropagation();
    if (singleClickTimerRef.current) {
      window.clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = undefined;
    }
    setTransform((value) =>
      value.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.4, x: 0, y: 0 },
    );
  }

  function closeFromImageClick(event: MouseEvent<HTMLImageElement>) {
    event.stopPropagation();
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    if (singleClickTimerRef.current) {
      window.clearTimeout(singleClickTimerRef.current);
    }
    singleClickTimerRef.current = window.setTimeout(() => {
      props.onClose();
      singleClickTimerRef.current = undefined;
    }, 220);
  }

  return (
    <div className={styles.overlay} onClick={props.onClose}>
      <div
        className={styles.backdrop}
        style={{ backgroundImage: `url("${currentResource.image}")` }}
      />
      <div className={styles.previewFrame} onClick={stopPreviewClick}>
        <div className={styles.previewContent}>
          <div
            ref={stageRef}
            className={`${styles.stage} ${
              isTouching ? styles.isGesturing : ""
            }`}
            style={{
              width: imageSize.width ? `${imageSize.width}px` : undefined,
              height: imageSize.height ? `${imageSize.height}px` : undefined,
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <img
              ref={imageRef}
              src={currentResource.image}
              alt={currentResource.topic}
              onLoad={updateImageSize}
              onClick={closeFromImageClick}
              onDoubleClick={toggleZoom}
              style={{
                transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
              }}
            />
            {previousResource && transform.scale === 1 && (
              <button
                type="button"
                className={`${styles.navButton} ${styles.previousButton}`}
                aria-label="上一张"
                onClick={() => props.onSelect?.(previousResource)}
              >
                {"<"}
              </button>
            )}
            {nextResource && transform.scale === 1 && (
              <button
                type="button"
                className={`${styles.navButton} ${styles.nextButton}`}
                aria-label="下一张"
                onClick={() => props.onSelect?.(nextResource)}
              >
                {">"}
              </button>
            )}
          </div>
          <div className={styles.actionPill} onClick={stopPreviewClick}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => copyImage(currentResource)}
            >
              <span>复制</span>
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => downloadImage(currentResource)}
            >
              <span>下载</span>
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.dangerButton}`}
              onClick={() => props.onDelete(currentResource)}
            >
              <span>删除</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
