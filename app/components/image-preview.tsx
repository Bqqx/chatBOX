"use client";

import {
  MouseEvent,
  TouchEvent,
  useEffect,
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
    setTransform({ scale: 1, x: 0, y: 0 });
  }, [currentResource.id]);

  function stopPreviewClick(event: MouseEvent) {
    event.stopPropagation();
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    event.stopPropagation();

    if (event.touches.length === 2) {
      const center = getTouchCenter(event.touches);
      gestureRef.current = {
        mode: "pinch",
        startScale: transform.scale,
        startX: transform.x,
        startY: transform.y,
        startDistance: getTouchDistance(event.touches),
        startCenterX: center.x,
        startCenterY: center.y,
        touchX: 0,
        touchY: 0,
      };
      return;
    }

    if (event.touches.length === 1 && transform.scale > 1) {
      gestureRef.current = {
        ...gestureRef.current,
        mode: "pan",
        startX: transform.x,
        startY: transform.y,
        touchX: event.touches[0].clientX,
        touchY: event.touches[0].clientY,
      };
    }
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (gesture.mode === "none") return;

    event.preventDefault();
    event.stopPropagation();

    if (gesture.mode === "pinch" && event.touches.length === 2) {
      const nextScale = clampScale(
        gesture.startScale *
          (getTouchDistance(event.touches) / gesture.startDistance),
      );
      const center = getTouchCenter(event.touches);
      setTransform({
        scale: nextScale,
        x: gesture.startX + center.x - gesture.startCenterX,
        y: gesture.startY + center.y - gesture.startCenterY,
      });
      return;
    }

    if (gesture.mode === "pan" && event.touches.length === 1) {
      setTransform({
        scale: transform.scale,
        x: gesture.startX + event.touches[0].clientX - gesture.touchX,
        y: gesture.startY + event.touches[0].clientY - gesture.touchY,
      });
    }
  }

  function onTouchEnd() {
    gestureRef.current.mode = "none";
    setTransform((value) =>
      value.scale <= 1.02 ? { scale: 1, x: 0, y: 0 } : value,
    );
  }

  function toggleZoom(event: MouseEvent<HTMLImageElement>) {
    event.stopPropagation();
    setTransform((value) =>
      value.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.4, x: 0, y: 0 },
    );
  }

  return (
    <div className={styles.overlay} onClick={props.onClose}>
      <div
        className={styles.backdrop}
        style={{ backgroundImage: `url("${currentResource.image}")` }}
      />
      <div className={styles.previewFrame} onClick={stopPreviewClick}>
        <div
          className={styles.stage}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <img
            src={currentResource.image}
            alt={currentResource.topic}
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
      </div>
      <div className={styles.actionPill} onClick={stopPreviewClick}>
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
  );
}
