"use client";

import React, {
  KeyboardEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import clsx from "clsx";

import styles from "./resource-manager.module.scss";

import { IconButton } from "./button";
import { Modal } from "./ui-lib";
import { useImageChatStore } from "../store";
import {
  filterImageResources,
  getImageResources,
  ImageResource,
  ImageResourceTimeFilter,
} from "../utils/image-resources";
import { useSearchParams } from "react-router-dom";

import DeleteIcon from "../icons/delete.svg";
import DownloadIcon from "../icons/download.svg";

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
    if (mime.includes("jpeg") || mime.includes("jpg") || mime.includes("jfif")) {
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

function downloadImage(resource: ImageResource) {
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

export function ResourceManager() {
  const imageChatStore = useImageChatStore();
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<ImageResource | undefined>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const allResources = useMemo(
    () => getImageResources(imageChatStore.sessions),
    [imageChatStore.sessions],
  );
  const sessionId = searchParams.get("session");
  const timeParam = searchParams.get("time");
  const timeFilter: ImageResourceTimeFilter =
    timeParam === "today" || timeParam === "week" ? timeParam : "all";
  const resources = useMemo(
    () =>
      filterImageResources(allResources, {
        sessionId,
        time: timeFilter,
      }),
    [allResources, sessionId, timeFilter],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedResources = useMemo(
    () => resources.filter((resource) => selectedIdSet.has(resource.id)),
    [resources, selectedIdSet],
  );
  const resourceIds = useMemo(
    () => new Set(resources.map((resource) => resource.id)),
    [resources],
  );
  const selectedCount = selectedResources.length;
  const hasSelection = selectedCount > 0;
  const allSelected =
    resources.length > 0 && selectedCount === resources.length;

  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => resourceIds.has(id)));
  }, [resourceIds]);

  function deleteSelectedImage() {
    if (!selected) return;
    deleteResources([selected]);
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : resources.map((resource) => resource.id));
  }

  function toggleResourceSelection(
    event: MouseEvent<HTMLButtonElement>,
    resourceId: string,
  ) {
    event.stopPropagation();
    setSelectedIds((ids) =>
      ids.includes(resourceId)
        ? ids.filter((id) => id !== resourceId)
        : ids.concat(resourceId),
    );
  }

  function downloadResources(targetResources: ImageResource[]) {
    targetResources.forEach((resource, index) => {
      window.setTimeout(() => downloadImage(resource), index * 120);
    });
  }

  function deleteResources(targetResources: ImageResource[]) {
    targetResources.forEach((resource) => {
      imageChatStore.deleteImage(
        resource.sessionId,
        resource.messageId,
        resource.image,
      );
    });
    setSelectedIds([]);
    setSelected(undefined);
  }

  function deleteSelectedResources() {
    deleteResources(selectedResources);
  }

  function downloadSelectedResources() {
    downloadResources(selectedResources);
  }

  function openResourceOnKey(
    event: KeyboardEvent<HTMLDivElement>,
    resource: ImageResource,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSelected(resource);
  }

  return (
    <div className={styles.resources}>
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">资源管理</div>
          <div className="window-header-sub-title">
            共 {resources.length} 张图片
          </div>
        </div>
        <div className={styles.toolbar}>
          <button
            type="button"
            className={clsx(styles.toolbarButton, {
              [styles.toolbarButtonActive]: allSelected,
            })}
            onClick={toggleSelectAll}
            disabled={resources.length === 0}
          >
            <span className={styles.checkbox}>{allSelected ? "\u2713" : ""}</span>
            全选
          </button>
          {hasSelection && (
            <>
              <button
                type="button"
                className={styles.toolbarButton}
                onClick={downloadSelectedResources}
              >
                下载 ({selectedCount})
              </button>
              <button
                type="button"
                className={clsx(styles.toolbarButton, styles.dangerButton)}
                onClick={deleteSelectedResources}
              >
                删除 ({selectedCount})
              </button>
            </>
          )}
        </div>
      </div>

      <div className={styles.body}>
        {resources.length === 0 ? (
          <div className={styles.empty}>暂无图片</div>
        ) : (
          <>
            <div className={styles.sectionTitle}>媒体内容</div>
            <div className={styles.grid}>
              {resources.map((resource) => (
                <div
                  key={resource.id}
                  role="button"
                  tabIndex={0}
                  className={clsx(styles.tile, {
                    [styles.tileSelected]: selectedIdSet.has(resource.id),
                  })}
                  onClick={() => setSelected(resource)}
                  onKeyDown={(event) => openResourceOnKey(event, resource)}
                >
                  <button
                    type="button"
                    aria-label="选择图片"
                    className={clsx(styles.selectButton, {
                      [styles.selectButtonActive]: selectedIdSet.has(
                        resource.id,
                      ),
                    })}
                    onClick={(event) =>
                      toggleResourceSelection(event, resource.id)
                    }
                  >
                    {selectedIdSet.has(resource.id) ? "\u2713" : ""}
                  </button>
                  <img src={resource.image} alt={resource.topic} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {selected && (
        <div
          className="modal-mask"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSelected(undefined);
            }
          }}
        >
          <Modal
            title="图片预览"
            defaultMax
            onClose={() => setSelected(undefined)}
            actions={[
              <IconButton
                key="download"
                icon={<DownloadIcon />}
                text="下载"
                bordered
                onClick={() => downloadImage(selected)}
              />,
              <IconButton
                key="delete"
                icon={<DeleteIcon />}
                text="删除"
                type="danger"
                bordered
                onClick={deleteSelectedImage}
              />,
            ]}
          >
            <div className={styles.preview}>
              <img src={selected.image} alt={selected.topic} />
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}
