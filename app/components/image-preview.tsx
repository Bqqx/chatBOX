import { MouseEvent, useEffect, useMemo } from "react";

import { ImageResource } from "../utils/image-resources";

import styles from "./image-preview.module.scss";

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

export function downloadImage(resource: ImageResource) {
  const link = document.createElement("a");
  const ext = getImageExtension(resource.image);
  link.href = resource.image;
  link.download = `image-${formatFileTime(new Date(resource.createdAt))}-${
    resource.imageIndex + 1
  }.${ext}`;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
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

  function stopPreviewClick(event: MouseEvent) {
    event.stopPropagation();
  }

  return (
    <div className={styles.overlay} onClick={props.onClose}>
      <div
        className={styles.backdrop}
        style={{ backgroundImage: `url("${currentResource.image}")` }}
      />
      <div className={styles.previewFrame} onClick={stopPreviewClick}>
        <div className={styles.stage}>
          <img src={currentResource.image} alt={currentResource.topic} />
          {previousResource && (
            <button
              type="button"
              className={`${styles.navButton} ${styles.previousButton}`}
              aria-label="上一张"
              onClick={() => props.onSelect?.(previousResource)}
            >
              {"<"}
            </button>
          )}
          {nextResource && (
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
