"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";

import chatStyles from "./chat.module.scss";
import homeStyles from "./home.module.scss";
import styles from "./image-chat.module.scss";

import { IconButton } from "./button";
import { SideBar } from "./sidebar";
import { WindowContent } from "./home";
import Locale from "../locales";
import { Path } from "../constant";
import { getClientConfig } from "../config/client";
import {
  createImageMessage,
  useAccessStore,
  useImageChatStore,
} from "../store";
import { copyToClipboard, useMobileScreen } from "../utils";
import { compressImage } from "../utils/chat";
import { ImagePreviewModal } from "./image-preview";
import { Modal, showPrompt, showToast } from "./ui-lib";
import { ImageResource } from "../utils/image-resources";
import {
  ensureCompletionNotificationPermission,
  notifyCompletionWhenBackground,
} from "../utils/native-notifications";

import ReturnIcon from "../icons/return.svg";
import SendWhiteIcon from "../icons/send-white.svg";
import ImageIcon from "../icons/image.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import DeleteIcon from "../icons/delete.svg";
import RenameIcon from "../icons/rename.svg";

import { useLocation, useNavigate } from "react-router-dom";

const IMAGE_RATIO_OPTIONS = [
  "",
  "1:1",
  "2:3",
  "3:2",
  "9:16",
  "16:9",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "21:9",
];

const IMAGE_ENGINE_OPTIONS = ["Nanobanana", "ChatGPT"] as const;
type ImageEngine = (typeof IMAGE_ENGINE_OPTIONS)[number];
const MAX_IMAGE_ATTACHMENTS = 3;

const NANO_MODEL_ALIASES: Record<string, string> = {
  "[Rim] gemini-3-pro-image-preview": "「Rim」gemini-3-pro-image-preview",
};

function normalizeRelayModelName(engine: ImageEngine, model: string) {
  const name = model.trim();
  if (engine !== "Nanobanana") return name;
  return NANO_MODEL_ALIASES[name] ?? name;
}

function getDefaultImageModel() {
  return "";
}

function isCrossEngineModel(engine: ImageEngine, model?: string) {
  const name = model?.trim().toLowerCase() ?? "";
  if (!name) return true;

  if (engine === "Nanobanana") {
    return name.startsWith("gpt-image") || name.startsWith("dall-e");
  }

  return name.includes("gemini") || name.includes("banana");
}

function getStoredImageModel(accessStore: any, engine: ImageEngine) {
  const engineModel =
    engine === "Nanobanana"
      ? accessStore.imageNanoModel
      : accessStore.imageChatGPTModel;

  if (!isCrossEngineModel(engine, engineModel)) {
    return normalizeRelayModelName(engine, engineModel);
  }

  return getDefaultImageModel();
}

function uniqueModels(models: string[]) {
  return Array.from(
    new Set(
      models.map((item) => item.trim()).filter((item) => item.length > 0),
    ),
  );
}

function getModelOptions(accessStore: any, engine: ImageEngine) {
  const selected = getStoredImageModel(accessStore, engine);
  const storedModels =
    engine === "Nanobanana"
      ? accessStore.imageNanoModels
      : accessStore.imageChatGPTModels;
  return uniqueModels([
    ...(Array.isArray(storedModels) ? storedModels : []),
    selected,
  ])
    .map((model) => normalizeRelayModelName(engine, model))
    .filter((model) => !isCrossEngineModel(engine, model));
}

function normalizeGeminiModel(model: string) {
  let name = model.trim();
  if (name.includes("/models/")) {
    name = name.slice(name.lastIndexOf("/models/") + "/models/".length);
  }
  for (const prefix of ["models/", "v1beta/"]) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
    }
  }
  return name;
}

function cleanImageRelayUrlInput(baseUrl: string) {
  return baseUrl
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .replace(/^[`"']+|[`"']+$/g, "")
    .replace(/\/+$/, "");
}

function normalizeImageRelayBaseUrl(baseUrl: string) {
  let url = cleanImageRelayUrlInput(baseUrl);

  if (url.startsWith("//")) {
    return `http:${url}`;
  }

  if (url && !url.startsWith("http") && !url.startsWith("/api/")) {
    url = url.replace(/^\/+/, "");
    const host = url.split("/")[0] ?? "";
    const shouldUseHttp =
      /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(host) ||
      /^\[[0-9a-f:]+\](:\d+)?$/i.test(host) ||
      /^localhost(:\d+)?$/i.test(host) ||
      host.includes(":");

    return `${shouldUseHttp ? "http" : "https"}://${url}`;
  }

  return url;
}

function buildGenerateContentEndpoint(baseUrl: string, model: string) {
  const normalizedBaseUrl = normalizeImageRelayBaseUrl(baseUrl);
  const normalizedModel = normalizeGeminiModel(model);
  const encodedModel = encodeURIComponent(normalizedModel);
  let endpoint = normalizedBaseUrl;

  if (endpoint.endsWith(":generateContent") || endpoint.includes(":generate")) {
    // already a complete Gemini-compatible endpoint
  } else if (endpoint.endsWith(`/${normalizedModel}`)) {
    endpoint = `${endpoint}:generateContent`;
  } else if (endpoint.includes("/models/")) {
    endpoint = `${endpoint.replace(/\/+$/, "")}:generateContent`;
  } else {
    endpoint = `${endpoint}/v1beta/models/${encodedModel}:generateContent`;
  }

  const isApp = !!getClientConfig()?.isApp;

  if (isApp || !normalizedBaseUrl.startsWith("http")) {
    return endpoint;
  }

  const proxyPath = endpoint
    .slice(normalizedBaseUrl.length)
    .replace(/^\/+/, "");
  return `/api/proxy/${proxyPath}`;
}

function buildOpenAIImageEndpoint(baseUrl: string) {
  const normalizedBaseUrl = normalizeImageRelayBaseUrl(baseUrl);
  let endpoint = normalizedBaseUrl.replace(/\/+$/, "");
  const knownEndpoints = [
    "/v1/images/generations",
    "/v1/images/edits",
    "/v1/responses",
  ];

  for (const known of knownEndpoints) {
    if (endpoint.endsWith(known)) {
      endpoint = endpoint.slice(0, -known.length);
      break;
    }
  }

  if (endpoint.endsWith("/v1/images")) {
    endpoint = `${endpoint}/generations`;
  } else if (endpoint.endsWith("/v1")) {
    endpoint = `${endpoint}/images/generations`;
  } else {
    endpoint = `${endpoint}/v1/images/generations`;
  }

  const isApp = !!getClientConfig()?.isApp;

  if (isApp || !normalizedBaseUrl.startsWith("http")) {
    return endpoint;
  }

  const proxyPath = endpoint
    .slice(normalizedBaseUrl.length)
    .replace(/^\/+/, "");
  return `/api/proxy/${proxyPath}`;
}

function sizeToGeminiImageConfig(size: string) {
  const pixelPresets: Record<
    string,
    { aspectRatio: string; imageSize: "1K" | "2K" | "4K" }
  > = {
    "1024x1024": { aspectRatio: "1:1", imageSize: "1K" },
    "1024x1536": { aspectRatio: "2:3", imageSize: "2K" },
    "1536x1024": { aspectRatio: "3:2", imageSize: "2K" },
    "1792x1024": { aspectRatio: "16:9", imageSize: "2K" },
    "1024x1792": { aspectRatio: "9:16", imageSize: "2K" },
  };

  if (pixelPresets[size]) return pixelPresets[size];
  if (IMAGE_RATIO_OPTIONS.includes(size)) {
    return { aspectRatio: size, imageSize: "2K" };
  }

  return { aspectRatio: "1:1", imageSize: "2K" };
}

function dataUrlToImagePart(image: string) {
  const normalized = normalizeDataImageUrl(image);
  const match = normalized.match(
    /^data:(image\/[a-zA-Z+.-]+);base64,([A-Za-z0-9+/=]+)$/,
  );

  if (match) {
    return {
      inlineData: {
        mimeType: match[1],
        data: match[2],
      },
    };
  }

  return {
    fileData: {
      mimeType: "image/png",
      fileUri: normalized,
    },
  };
}

function buildGenerateContentPayload(
  prompt: string,
  size: string,
  sourceImages: string[] = [],
) {
  const imageConfig = size ? sizeToGeminiImageConfig(size) : undefined;
  const promptWithParams = imageConfig
    ? `${prompt} [分辨率: ${imageConfig.imageSize}, 比例: ${imageConfig.aspectRatio}]`
    : prompt;

  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: promptWithParams },
          ...sourceImages.map(dataUrlToImagePart),
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      ...(imageConfig ? { imageConfig } : {}),
    },
  };
}

function ratioToOpenAIImageSize(ratio: string) {
  const presets: Record<string, string> = {
    "1:1": "1024x1024",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
    "9:16": "1024x1536",
    "16:9": "1536x1024",
    "3:4": "1024x1536",
    "4:3": "1536x1024",
    "4:5": "1024x1536",
    "5:4": "1536x1024",
    "21:9": "1536x1024",
  };

  return presets[ratio] ?? "1024x1024";
}

function buildOpenAIImagePayload(
  model: string,
  prompt: string,
  ratio: string,
  count: number,
  sourceImages: string[] = [],
) {
  const imageSize = ratio ? ratioToOpenAIImageSize(ratio) : undefined;
  return {
    model,
    prompt,
    ...(imageSize ? { size: imageSize } : {}),
    n: count,
    ...(sourceImages.length > 0
      ? { image: sourceImages.length === 1 ? sourceImages[0] : sourceImages }
      : {}),
  };
}

function summarizeImagePayloadForLog(image: unknown) {
  const images = Array.isArray(image) ? image : image ? [image] : [];

  return {
    imageCount: images.length,
    imageShape: Array.isArray(image) ? "array" : image ? "single" : "none",
    images: images.map((item) => {
      if (typeof item !== "string") {
        return { type: typeof item };
      }

      const mimeMatch = item.match(/^data:([^;]+);base64,/);
      return {
        type: "data-url",
        mime: mimeMatch?.[1] ?? "",
        length: item.length,
      };
    }),
  };
}

function logOpenAIImageRequestForDebug(
  requestUrl: string,
  baseUrl: string,
  payload: ReturnType<typeof buildOpenAIImagePayload>,
  image?: unknown,
) {
  if (process.env.NODE_ENV === "production") return;

  const { prompt, ...safePayload } = payload;
  const imageCount = Array.isArray(image) ? image.length : image ? 1 : 0;
  console.info(
    "[ChatBox][GPT image request]",
    JSON.stringify({
      requestUrl,
      baseUrl,
      payload: {
        ...safePayload,
        promptLength: prompt.length,
        hasImage: imageCount > 0,
        ...summarizeImagePayloadForLog(image),
      },
    }),
  );
}

function buildNanoBananaPayload(
  prompt: string,
  size: string,
  sourceImages: string[] = [],
) {
  const imageConfig = size ? sizeToGeminiImageConfig(size) : undefined;
  const promptWithParams = imageConfig
    ? `${prompt} [分辨率: ${imageConfig.imageSize}, 比例: ${imageConfig.aspectRatio}]`
    : prompt;

  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: promptWithParams },
          ...sourceImages.map(dataUrlToImagePart),
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      ...(imageConfig ? { imageConfig } : {}),
    },
  };
}

function extractTextFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text ?? "";
      if (part?.text) return part.text;
      if (part?.image_url?.url) return part.image_url.url;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeDataImageUrl(input: string) {
  const match = input.match(
    /data:(image\/[a-zA-Z+.-]+);base64,([\sA-Za-z0-9+/=]+)/,
  );
  if (!match) return input;

  return `data:${match[1]};base64,${match[2].replace(/\s+/g, "")}`;
}

function buildDataImageUrl(base64: string, mimeType = "image/png") {
  return `data:${mimeType};base64,${base64.replace(/\s+/g, "")}`;
}

function isValidImageSrc(src: string) {
  if (!src) return false;
  if (src.startsWith("http://") || src.startsWith("https://")) return true;

  const dataImage = src.match(
    /^data:image\/[a-zA-Z+.-]+;base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!dataImage) return false;

  const base64 = dataImage[1];
  return base64.length > 120 && base64.length % 4 === 0;
}

function normalizeImageSources(images: string[]) {
  return Array.from(
    new Set(images.map(normalizeDataImageUrl).filter(isValidImageSrc)),
  );
}

async function normalizeImagesForDisplay(images: string[]) {
  return normalizeImageSources(images);
}

const imageBlobUrlCache = new Map<string, string>();

function dataUrlToBlobUrl(dataUrl: string) {
  const cachedUrl = imageBlobUrlCache.get(dataUrl);
  if (cachedUrl) return cachedUrl;

  const [header, base64] = dataUrl.split(",", 2);
  const mimeType = header.match(/^data:([^;]+);base64$/)?.[1] ?? "image/png";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  imageBlobUrlCache.set(dataUrl, blobUrl);
  return blobUrl;
}

function ImageResult(props: {
  resource: ImageResource;
  onOpen: (resource: ImageResource) => void;
}) {
  const { resource } = props;
  const image = resource.image;
  const [imageUrl, setImageUrl] = useState(() =>
    image.startsWith("data:image/")
      ? imageBlobUrlCache.get(image) ?? ""
      : image,
  );

  useEffect(() => {
    if (!image.startsWith("data:image/")) {
      setImageUrl(image);
      return;
    }

    const cachedUrl = imageBlobUrlCache.get(image);
    if (cachedUrl) {
      setImageUrl(cachedUrl);
      return;
    }

    setImageUrl("");
    const buildBlobUrl = () => setImageUrl(dataUrlToBlobUrl(image));
    const timer = globalThis.setTimeout(buildBlobUrl, 0);
    return () => globalThis.clearTimeout(timer);
  }, [image]);

  return (
    <a
      className={styles["image-link"]}
      href={imageUrl}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        if (!imageUrl) return;
        props.onOpen(resource);
      }}
    >
      {imageUrl ? (
        <img
          className={styles["image-result"]}
          src={imageUrl}
          alt={Locale.ImageChat.Title}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className={styles["image-result-placeholder"]}>图片加载中...</div>
      )}
    </a>
  );
}

function ImageChatAction(props: { text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={clsx(styles["image-chat-action"], "clickable")}
      title={props.text}
      onClick={props.onClick}
    >
      <div className={styles["image-chat-action-text"]}>{props.text}</div>
    </button>
  );
}

function ModelSelector(props: {
  value: string;
  options: string[];
  placeholder: string;
  ariaLabel: string;
  displayNames?: Record<string, string>;
  onSelect: (value: string) => void;
  onAdd?: (value: string) => void;
  onDelete?: (value: string) => void;
}) {
  const selectorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [newModel, setNewModel] = useState("");
  const hasSelectedValue = props.options.includes(props.value);
  const currentModel = hasSelectedValue ? props.value : props.placeholder;
  const currentModelLabel = hasSelectedValue
    ? props.displayNames?.[currentModel] ?? currentModel
    : currentModel;
  const editable = Boolean(props.onAdd && props.onDelete);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function addModel() {
    const model = newModel.trim();
    if (!model || !props.onAdd) return;
    props.onAdd(model);
    setNewModel("");
    setOpen(false);
  }

  return (
    <div className={styles["model-selector"]} ref={selectorRef}>
      <button
        type="button"
        aria-label={props.ariaLabel}
        aria-expanded={open}
        className={styles["model-selector-trigger"]}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{currentModelLabel}</span>
        <span className={styles["model-selector-arrow"]}>v</span>
      </button>
      {open && (
        <div className={styles["model-selector-menu"]}>
          <div className={styles["model-selector-list"]}>
            {props.options.map((model) => (
              <div
                key={model || "__empty__"}
                className={clsx(styles["model-selector-option"], {
                  [styles["model-selector-option-active"]]:
                    hasSelectedValue && model === currentModel,
                  [styles["model-selector-option-readonly"]]: !editable,
                })}
              >
                <button
                  type="button"
                  className={styles["model-selector-option-name"]}
                  onClick={() => {
                    props.onSelect(model);
                    setOpen(false);
                  }}
                >
                  {props.displayNames?.[model] ?? model}
                </button>
                {editable && (
                  <button
                    type="button"
                    aria-label={`删除模型 ${model}`}
                    className={styles["model-selector-delete"]}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onDelete?.(model);
                    }}
                  >
                    x
                  </button>
                )}
              </div>
            ))}
          </div>
          {editable && (
            <div className={styles["model-selector-add"]}>
              <input
                aria-label="新增模型名称"
                value={newModel}
                placeholder="新增模型名称"
                onChange={(event) => setNewModel(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addModel();
                  }
                  if (event.key === "Escape") {
                    setOpen(false);
                  }
                }}
              />
              <button
                type="button"
                aria-label="新增模型"
                title="新增模型"
                onClick={addModel}
                disabled={!newModel.trim()}
              >
                +
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function collectImageUrlsFromObject(input: any): string[] {
  const urls: string[] = [];

  const walk = (value: any) => {
    if (!value) return;
    if (typeof value === "string") {
      urls.push(...extractImageUrlsFromText(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      if (value.url) urls.push(value.url);
      if (value.image) urls.push(value.image);
      if (value.result) urls.push(value.result);
      if (value.b64_json) urls.push(buildDataImageUrl(value.b64_json));
      if (
        value.inlineData?.data &&
        value.inlineData?.mimeType?.startsWith?.("image/")
      ) {
        urls.push(
          buildDataImageUrl(value.inlineData.data, value.inlineData.mimeType),
        );
      }
      if (
        value.inline_data?.data &&
        value.inline_data?.mime_type?.startsWith?.("image/")
      ) {
        urls.push(
          buildDataImageUrl(
            value.inline_data.data,
            value.inline_data.mime_type,
          ),
        );
      }
      if (value.image_url?.url) urls.push(value.image_url.url);
      Object.values(value).forEach(walk);
    }
  };

  walk(input);
  return normalizeImageSources(urls);
}

function extractImageUrlsFromText(text: string) {
  const urls: string[] = [];

  const markdownImageRegex =
    /!\[[^\]]*]\s*\(\s*(data:image\/[a-zA-Z+.-]+;base64,[\s\S]*?|https?:\/\/[^)\s]+)\s*\)/g;
  const looseMarkdownDataImageRegex =
    /!\[[^\]]*]\s*\n+\s*\(\s*(data:image\/[a-zA-Z+.-]+;base64,[\s\S]*?)\s*\)/g;
  const htmlImageRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  const dataImageRegex = /data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+/g;
  const plainUrlRegex = /https?:\/\/[^\s"'<>)}]+/g;

  for (const match of text.matchAll(markdownImageRegex)) {
    urls.push(normalizeDataImageUrl(match[1]));
  }
  for (const match of text.matchAll(looseMarkdownDataImageRegex)) {
    urls.push(normalizeDataImageUrl(match[1]));
  }
  for (const match of text.matchAll(htmlImageRegex)) {
    urls.push(normalizeDataImageUrl(match[1]));
  }
  urls.push(...(text.match(dataImageRegex) ?? []).map(normalizeDataImageUrl));
  urls.push(...(text.match(plainUrlRegex) ?? []));

  try {
    const parsed = JSON.parse(text);
    urls.push(...collectImageUrlsFromObject(parsed));
  } catch {
    // The model often returns markdown rather than JSON.
  }

  return normalizeImageSources(urls);
}

function stripImagePayload(text: string, images: string[]) {
  let cleanText = text;

  cleanText = cleanText
    .replace(
      /!\[[^\]]*]\s*\(\s*(data:image\/[a-zA-Z+.-]+;base64,[\sA-Za-z0-9+/=]+|https?:\/\/[^)\s]+)\s*\)/g,
      "",
    )
    .replace(
      /!\[[^\]]*]\s*\n+\s*\(\s*data:image\/[a-zA-Z+.-]+;base64,[\sA-Za-z0-9+/=]+\s*\)/g,
      "",
    )
    .replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, "")
    .replace(/data:image\/[a-zA-Z+.-]+;base64,[\sA-Za-z0-9+/=]+/g, "")
    .replace(/[A-Za-z0-9+/]{300,}={0,2}/g, "")
    .replace(/https?:\/\/[^\s"'<>)}]+/g, "");

  images.forEach((image) => {
    if (!image.startsWith("data:image/")) {
      cleanText = cleanText.split(image).join("");
    }
  });

  // Some relays return only raw base64 without the data:image prefix.
  cleanText = cleanText
    .split(/\s+/)
    .filter((word) => {
      const maybeBase64 = /^[A-Za-z0-9+/=]+$/.test(word);
      return !(maybeBase64 && word.length > 120);
    })
    .join(" ");

  return cleanText.trim();
}

function isRawImageResponseText(text: string) {
  if (!text) return false;

  const markers = [
    '"candidates"',
    '"inlineData"',
    '"inline_data"',
    '"usageMetadata"',
    '"modelVersion"',
    '"finishReason"',
    '"mimeType"',
    '"mime_type"',
    "data:image/",
    "![image]",
  ];

  const hasMarker = markers.some((marker) => text.includes(marker));
  const hasLongBase64 = /[A-Za-z0-9+/]{300,}={0,2}/.test(text);

  return hasMarker || hasLongBase64;
}

function getDisplayContent(text: string, images: string[]) {
  if (images.length === 0) {
    return isRawImageResponseText(text) ? "" : text;
  }

  const stripped = stripImagePayload(text, images);
  if (!stripped || isRawImageResponseText(stripped)) {
    return "";
  }

  return stripped;
}

function extractImageUrls(data: any) {
  const items = Array.isArray(data?.data) ? data.data : [];
  const messageContent = data?.choices?.at?.(0)?.message?.content;
  const directImages = collectImageUrlsFromObject(data);
  const dataImages = collectImageUrlsFromObject(items);
  const contentImages = extractImageUrlsFromText(
    extractTextFromContent(messageContent),
  );

  return Array.from(
    new Set([...directImages, ...dataImages, ...contentImages]),
  );
}

function extractAssistantText(data: any) {
  return (
    extractTextFromContent(data?.choices?.at?.(0)?.message?.content) ||
    extractTextFromContent(data?.candidates?.at?.(0)?.content?.parts)
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "生成超时，请稍后重试或降低图片分辨率";
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function clampImageCount(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.floor(value), 1), 4);
}

function ImageCountStepper(props: {
  value: number;
  onChange: (value: number) => void;
}) {
  const value = clampImageCount(props.value);

  return (
    <div className={styles["image-count-stepper"]}>
      <button
        type="button"
        aria-label="Decrease image count"
        onClick={() => props.onChange(clampImageCount(value - 1))}
        disabled={value <= 1}
      >
        -
      </button>
      <span>{value}</span>
      <button
        type="button"
        aria-label="Increase image count"
        onClick={() => props.onChange(clampImageCount(value + 1))}
        disabled={value >= 4}
      >
        +
      </button>
    </div>
  );
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const IMAGE_REQUEST_TIMEOUT_MS = 300000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    IMAGE_REQUEST_TIMEOUT_MS,
  );

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readResponseJson(response: Response) {
  const text = await response.text();
  if (!text) return {};

  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType.includes("text/html") ||
    /^\s*<!doctype\s+html/i.test(text) ||
    /^\s*<html[\s>]/i.test(text)
  ) {
    return {
      message:
        "请求没有到达生图接口，返回了网页 HTML。请检查接口地址是否为中转站根地址，并刷新页面后重试。",
      htmlResponse: true,
      status: response.status,
      url: response.url,
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function postJsonWithRetry(
  requestUrl: string,
  headers: Record<string, string>,
  payload: unknown,
  options: { maxAttempts?: number } = {},
) {
  const requestOptions = {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  };

  const maxAttempts = options.maxAttempts ?? 2;
  let json: any = {};
  let response: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    response = await fetchWithTimeout(requestUrl, requestOptions);
    json = await readResponseJson(response);

    if (
      !response.ok &&
      RETRYABLE_STATUS.has(response.status) &&
      attempt < maxAttempts
    ) {
      await sleep(1200);
      continue;
    }

    break;
  }

  if (!response?.ok) {
    throw new Error(getResponseErrorMessage(json, response?.status ?? 500));
  }

  return json;
}

function getResponseErrorMessage(json: any, status: number) {
  return (
    json?.error?.message ||
    json?.error?.error?.message ||
    json?.message ||
    json?.msg ||
    `${Locale.ImageChat.Error}: ${status}`
  );
}

export function ImageChat() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobileScreen = useMobileScreen();
  const accessStore = useAccessStore();
  const imageChatStore = useImageChatStore();
  const session = imageChatStore.currentSession();
  const allMessages = session.messages;
  const messages = useMemo(
    () => allMessages.filter((message) => !message.hidden),
    [allMessages],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const favoritePromptInputRef = useRef<HTMLTextAreaElement>(null);
  const savedEngine = IMAGE_ENGINE_OPTIONS.includes(
    accessStore.imageEngine as ImageEngine,
  )
    ? (accessStore.imageEngine as ImageEngine)
    : "Nanobanana";

  const [prompt, setPrompt] = useState("");
  const [engine, setEngine] = useState<ImageEngine>(savedEngine);
  const [model, setModel] = useState(
    getStoredImageModel(accessStore, savedEngine),
  );
  const modelOptions = getModelOptions(accessStore, engine);
  const [size, setSize] = useState("1:1");
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachImages, setAttachImages] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<
    ImageResource | undefined
  >();
  const [activePromptActionsId, setActivePromptActionsId] = useState<
    string | null
  >(null);
  const [showFavoritePrompts, setShowFavoritePrompts] = useState(false);
  const [favoritePromptDraft, setFavoritePromptDraft] = useState("");
  const [showImageSettings, setShowImageSettings] = useState(false);
  const favoritePrompts = imageChatStore.favoritePrompts ?? [];
  const showMobileDetail =
    !isMobileScreen || (location.state as { showDetail?: boolean })?.showDetail;
  const renderedMessages = useMemo(
    () =>
      messages.map((message) => {
        const displayImages = normalizeImageSources(
          message.images && message.images.length > 0
            ? message.images
            : extractImageUrlsFromText(message.content),
        );
        const displayContent = getDisplayContent(
          message.content,
          displayImages,
        );

        return {
          message,
          displayImages,
          displayContent,
          deletedImages: message.deletedImages ?? 0,
        };
      }),
    [messages],
  );
  const sessionImageResources = useMemo(
    () =>
      renderedMessages.flatMap(({ message, displayImages }) => {
        if (message.role !== "assistant") return [];

        return displayImages.map((image, index) => ({
          id: `${session.id}-${message.id}-${index}`,
          sessionId: session.id,
          messageId: message.id,
          imageIndex: index,
          image,
          topic: session.topic,
          createdAt: message.createdAt,
          kind: "generated" as const,
        }));
      }),
    [renderedMessages, session.id, session.topic],
  );

  const canUseImageRelay = useMemo(() => {
    return (
      accessStore.imageUrl.trim().length > 0 &&
      accessStore.imageApiKey.trim().length > 0
    );
  }, [accessStore.imageApiKey, accessStore.imageUrl]);
  const hasImageModel = useMemo(() => {
    const selectedModel = !isCrossEngineModel(engine, model)
      ? model
      : getStoredImageModel(accessStore, engine);
    return normalizeRelayModelName(engine, selectedModel).trim().length > 0;
  }, [accessStore, engine, model]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  useEffect(() => {
    setActivePromptActionsId(null);
  }, [session.id]);

  useEffect(() => {
    if (!activePromptActionsId) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-prompt-action-scope='true']")) {
        return;
      }
      setActivePromptActionsId(null);
    };

    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [activePromptActionsId]);

  useEffect(() => {
    if (!model.trim()) return;
    if (!isCrossEngineModel(engine, model)) return;
    const nextModel = getStoredImageModel(accessStore, engine);
    if (!nextModel.trim() || nextModel === model) return;

    setModel(nextModel);
    accessStore.update((access) => {
      const currentEngineModel =
        engine === "Nanobanana"
          ? access.imageNanoModel
          : access.imageChatGPTModel;
      if (access.imageModel === nextModel && currentEngineModel === nextModel) {
        return;
      }

      access.imageModel = nextModel;
      if (engine === "Nanobanana") {
        access.imageNanoModel = nextModel;
      } else {
        access.imageChatGPTModel = nextModel;
      }
    });
  }, [accessStore, engine, model]);

  useEffect(() => {
    const storedModel = getStoredImageModel(accessStore, engine);
    if (storedModel !== model) {
      setModel(storedModel);
    }
  }, [
    accessStore,
    accessStore.imageChatGPTModel,
    accessStore.imageNanoModel,
    engine,
    model,
  ]);

  function updateEngine(nextEngine: ImageEngine) {
    const nextModel = getStoredImageModel(accessStore, nextEngine);
    setEngine(nextEngine);
    setModel(nextModel);
    accessStore.update((access) => {
      access.imageEngine = nextEngine;
      access.imageModel = nextModel;
      if (nextEngine === "Nanobanana") {
        access.imageNanoModel = nextModel;
      } else {
        access.imageChatGPTModel = nextModel;
      }
    });
  }

  function updateModel(nextModel: string) {
    setModel(nextModel);
    accessStore.update((access) => {
      access.imageModel = nextModel;
      if (engine === "Nanobanana") {
        access.imageNanoModel = nextModel;
        access.imageNanoModels = uniqueModels([
          ...(Array.isArray(access.imageNanoModels)
            ? access.imageNanoModels
            : []),
          nextModel,
        ]);
      } else {
        access.imageChatGPTModel = nextModel;
        access.imageChatGPTModels = uniqueModels([
          ...(Array.isArray(access.imageChatGPTModels)
            ? access.imageChatGPTModels
            : []),
          nextModel,
        ]);
      }
    });
  }

  function addModelOption(nextModel: string) {
    updateModel(nextModel);
  }

  function deleteModelOption(targetModel: string) {
    const nextOptions = modelOptions.filter((item) => item !== targetModel);
    const fallback = nextOptions[0] ?? getDefaultImageModel();
    accessStore.update((access) => {
      if (engine === "Nanobanana") {
        access.imageNanoModels = nextOptions;
        if (model === targetModel) {
          access.imageNanoModel = fallback;
          access.imageModel = fallback;
        }
      } else {
        access.imageChatGPTModels = nextOptions;
        if (model === targetModel) {
          access.imageChatGPTModel = fallback;
          access.imageModel = fallback;
        }
      }
    });

    if (model === targetModel) {
      setModel(fallback);
    }
  }

  function updateSessionTopic() {
    showPrompt("编辑标题", session.topic, 1).then((nextTopic) => {
      const topic = nextTopic.trim();
      if (!topic) return;
      imageChatStore.updateTargetSession(session, (targetSession) => {
        targetSession.topic = topic;
        targetSession.lastUpdate = Date.now();
      });
    });
  }

  function hideMessage(messageId: string) {
    imageChatStore.updateTargetSession(session, (targetSession) => {
      targetSession.messages = targetSession.messages.map((message) =>
        message.id === messageId ? { ...message, hidden: true } : message,
      );
      targetSession.lastUpdate = Date.now();
    });
  }

  function copyMessage(message: (typeof messages)[number]) {
    const images = normalizeImageSources(
      message.images && message.images.length > 0
        ? message.images
        : extractImageUrlsFromText(message.content),
    );
    const displayContent = getDisplayContent(message.content, images).trim();
    const copyContent =
      displayContent || images.join("\n") || message.model || "";

    if (copyContent) {
      copyToClipboard(copyContent);
    }
  }

  function favoritePrompt(message: (typeof messages)[number]) {
    const content = message.content.trim();
    if (!content) return;

    imageChatStore.addFavoritePrompt(content);
    showToast("已收藏提示词");
  }

  function resizeFavoritePromptInput(element = favoritePromptInputRef.current) {
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }

  function openFavoritePrompts() {
    setFavoritePromptDraft("");
    setShowFavoritePrompts(true);
    requestAnimationFrame(() => resizeFavoritePromptInput());
  }

  function addFavoritePromptFromDraft() {
    const content = favoritePromptDraft.trim();
    if (!content) return;

    const exists = favoritePrompts.some((item) => item.content === content);
    imageChatStore.addFavoritePrompt(content);
    showToast(exists ? "提示词已在收藏中" : "已添加收藏提示词");
    setFavoritePromptDraft("");
    requestAnimationFrame(() => resizeFavoritePromptInput());
  }

  function applyFavoritePrompt(content: string) {
    setPrompt(content);
    setShowFavoritePrompts(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const addImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setUploading(true);
    try {
      const images = await Promise.all(
        imageFiles
          .slice(0, MAX_IMAGE_ATTACHMENTS)
          .map((file) => compressImage(file, 768 * 1024)),
      );

      setAttachImages((current) => {
        const nextImages = [...current, ...images].slice(
          0,
          MAX_IMAGE_ATTACHMENTS,
        );
        if (current.length + images.length > MAX_IMAGE_ATTACHMENTS) {
          showToast(`最多上传 ${MAX_IMAGE_ATTACHMENTS} 张图片`);
        }
        return nextImages;
      });
    } catch (error) {
      showToast(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }, []);

  const handlePasteImage = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.items)
        .filter(
          (item) => item.kind === "file" && item.type.startsWith("image/"),
        )
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (files.length === 0) return;
      event.preventDefault();
      void addImageFiles(files);
    },
    [addImageFiles],
  );

  function uploadImage() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*,.heic,.heif";
    fileInput.multiple = true;
    fileInput.onchange = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const files = Array.from(target.files ?? []);
      void addImageFiles(files);
    };
    fileInput.click();
  }

  async function sendPrompt(promptText = prompt, clearInput = true) {
    const text = promptText.trim();
    if (!text || generating) return;

    const activeEngine = engine;
    const activeModel = normalizeRelayModelName(
      activeEngine,
      !isCrossEngineModel(activeEngine, model)
        ? model
        : getStoredImageModel(accessStore, activeEngine),
    );

    if (!activeModel.trim()) {
      showToast("请先设置生图模型名称", undefined, 5000);
      return;
    }

    if (!canUseImageRelay) {
      showToast(Locale.ImageChat.NeedCustomRelay, undefined, 5000);
      imageChatStore.addMessages([
        createImageMessage({
          role: "assistant",
          content: Locale.ImageChat.NeedCustomRelay,
          status: "error",
        }),
      ]);
      return;
    }

    const targetSessionId = session.id;
    const sourceImages = attachImages.slice(0, MAX_IMAGE_ATTACHMENTS);
    accessStore.update((access) => {
      access.imageModel = activeModel;
      if (activeEngine === "Nanobanana") {
        access.imageNanoModel = activeModel;
      } else {
        access.imageChatGPTModel = activeModel;
      }
    });
    const userMessage = createImageMessage({
      role: "user",
      content: text,
      images: sourceImages,
    });
    const assistantMessage = createImageMessage({
      role: "assistant",
      content: Locale.ImageChat.Generating,
      status: "loading",
      model: `${activeEngine}: ${activeModel}`,
    });
    const assistantId = assistantMessage.id;

    imageChatStore.addMessages([userMessage, assistantMessage]);
    if (clearInput) {
      setPrompt("");
      setAttachImages([]);
    }
    setGenerating(true);
    void ensureCompletionNotificationPermission();

    try {
      const baseUrl = normalizeImageRelayBaseUrl(accessStore.imageUrl);
      const jsonHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessStore.imageApiKey.trim()}`,
      };
      if (!getClientConfig()?.isApp && baseUrl.startsWith("http")) {
        jsonHeaders["x-base-url"] = baseUrl;
      }

      const targetCount = clampImageCount(count);
      const images: string[] = [];
      const errors: string[] = [];

      if (activeEngine === "ChatGPT") {
        const requestUrl = buildOpenAIImageEndpoint(accessStore.imageUrl);
        const payload = buildOpenAIImagePayload(
          activeModel,
          text,
          size,
          targetCount,
          sourceImages,
        );
        logOpenAIImageRequestForDebug(
          requestUrl,
          baseUrl,
          payload,
          sourceImages,
        );

        const json = await postJsonWithRetry(requestUrl, jsonHeaders, payload, {
          maxAttempts: 1,
        });
        const batchImages = extractImageUrls(json);
        const assistantText = extractAssistantText(json);
        if (batchImages.length === 0) {
          throw new Error(assistantText || JSON.stringify(json, null, 2));
        }

        const displayImages = await normalizeImagesForDisplay(batchImages);
        imageChatStore.updateMessage(
          targetSessionId,
          assistantId,
          (message) => {
            message.content = "";
            message.images = displayImages;
            message.status = undefined;
            message.createdAt = Date.now();
          },
        );
        void notifyCompletionWhenBackground();
        return;
      }

      const requestUrl = buildGenerateContentEndpoint(
        accessStore.imageUrl,
        activeModel,
      );

      for (let index = 0; index < targetCount; index += 1) {
        imageChatStore.updateMessage(
          targetSessionId,
          assistantId,
          (message) => {
            message.content =
              targetCount > 1
                ? `${Locale.ImageChat.Generating} (${index + 1}/${targetCount})`
                : Locale.ImageChat.Generating;
          },
        );

        try {
          const json = await postJsonWithRetry(
            requestUrl,
            jsonHeaders,
            buildNanoBananaPayload(text, size, sourceImages),
          );

          const batchImages = extractImageUrls(json);
          const assistantText = extractAssistantText(json);
          if (batchImages.length === 0) {
            throw new Error(assistantText || JSON.stringify(json, null, 2));
          }

          images.push(...batchImages);
          const currentImages = await normalizeImagesForDisplay(images);
          imageChatStore.updateMessage(
            targetSessionId,
            assistantId,
            (message) => {
              message.content =
                targetCount > 1 && currentImages.length < targetCount
                  ? `${Locale.ImageChat.Generating} (${currentImages.length}/${targetCount})`
                  : "";
              message.images = currentImages;
            },
          );
        } catch (error) {
          errors.push(
            `[${index + 1}/${targetCount}] ${getErrorMessage(error)}`,
          );
        }
      }

      const displayImages = await normalizeImagesForDisplay(images);
      if (displayImages.length === 0) {
        throw new Error(errors.join("\n") || Locale.ImageChat.Error);
      }

      imageChatStore.updateMessage(targetSessionId, assistantId, (message) => {
        message.content = errors.length > 0 ? errors.join("\n") : "";
        message.images = displayImages;
        message.status = errors.length > 0 ? "error" : undefined;
        message.createdAt = Date.now();
      });
      void notifyCompletionWhenBackground();
    } catch (error) {
      const message = getErrorMessage(error);
      imageChatStore.updateMessage(targetSessionId, assistantId, (item) => {
        item.content = message;
        item.status = "error";
        item.createdAt = Date.now();
      });
      void notifyCompletionWhenBackground();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      {(!isMobileScreen || !showMobileDetail) && (
        <SideBar className={homeStyles["sidebar-show"]} mode="image" />
      )}
      {showMobileDetail && (
        <WindowContent>
          <div className={chatStyles.chat}>
            <div className="window-header" data-tauri-drag-region>
              {isMobileScreen && (
                <div className="window-actions">
                  <div className="window-action-button">
                    <IconButton
                      icon={<ReturnIcon />}
                      bordered
                      title="返回"
                      onClick={() =>
                        navigate(Path.Sd, { state: { showDetail: false } })
                      }
                    />
                  </div>
                </div>
              )}
              <div
                className={clsx(
                  "window-header-title",
                  chatStyles["chat-body-title"],
                )}
              >
                <div
                  className={clsx(
                    "window-header-main-title",
                    chatStyles["chat-body-main-title"],
                  )}
                  onClickCapture={updateSessionTopic}
                >
                  {session.topic || Locale.ImageChat.Title}
                </div>
                <div className="window-header-sub-title">
                  {Locale.Chat.SubTitle(messages.length)}
                </div>
              </div>

              <div className="window-actions">
                <div className="window-action-button">
                  <IconButton
                    icon={<RenameIcon />}
                    bordered
                    title={Locale.Chat.EditMessage.Title}
                    aria={Locale.Chat.EditMessage.Title}
                    onClick={updateSessionTopic}
                  />
                </div>
              </div>
            </div>

            <div
              className={clsx(chatStyles["chat-body"], {
                [styles["image-body-settings-open"]]: showImageSettings,
              })}
              ref={scrollRef}
            >
              <div className={styles["image-body"]}>
                {messages.length === 0 ? (
                  <div className={styles.empty}>{Locale.ImageChat.Empty}</div>
                ) : (
                  renderedMessages.map(
                    ({
                      message,
                      displayImages,
                      displayContent,
                      deletedImages,
                    }) => {
                      const showActions =
                        message.status !== "loading" &&
                        (displayContent.length > 0 ||
                          displayImages.length > 0 ||
                          deletedImages > 0 ||
                          message.status === "error");
                      const showPromptActions =
                        showActions &&
                        message.role === "user" &&
                        activePromptActionsId === message.id;

                      return (
                        <div
                          key={message.id}
                          className={clsx(chatStyles["chat-message"], {
                            [chatStyles["chat-message-user"]]:
                              message.role === "user",
                          })}
                        >
                          <div className={chatStyles["chat-message-container"]}>
                            {showActions && message.role !== "user" && (
                              <div className={styles["image-message-actions"]}>
                                <ImageChatAction
                                  text="从对话移除"
                                  onClick={() => hideMessage(message.id)}
                                />
                              </div>
                            )}
                            <div
                              className={clsx(styles["image-message-content"], {
                                [styles["image-message-content-media"]]:
                                  displayImages.length > 0,
                                [styles["image-message-content-user"]]:
                                  message.role === "user",
                              })}
                            >
                              {(displayContent ||
                                message.status === "error") && (
                                <div
                                  className={clsx({
                                    [styles["prompt-action-scope"]]:
                                      message.role === "user",
                                  })}
                                  data-prompt-action-scope={
                                    message.role === "user" ? "true" : undefined
                                  }
                                >
                                  <div
                                    className={clsx(
                                      chatStyles["chat-message-item"],
                                      {
                                        [styles.error]:
                                          message.status === "error",
                                        [styles["prompt-message-bubble"]]:
                                          message.role === "user",
                                      },
                                    )}
                                    onClick={
                                      message.role === "user"
                                        ? () =>
                                            setActivePromptActionsId(
                                              (current) =>
                                                current === message.id
                                                  ? null
                                                  : message.id,
                                            )
                                        : undefined
                                    }
                                  >
                                    {displayContent}
                                  </div>
                                  {showPromptActions && (
                                    <div
                                      className={clsx(
                                        styles["image-message-actions"],
                                        styles["image-message-actions-user"],
                                      )}
                                    >
                                      <ImageChatAction
                                        text="收藏"
                                        onClick={() => {
                                          favoritePrompt(message);
                                          setActivePromptActionsId(null);
                                        }}
                                      />
                                      <ImageChatAction
                                        text="从对话移除"
                                        onClick={() => {
                                          hideMessage(message.id);
                                          setActivePromptActionsId(null);
                                        }}
                                      />
                                      <ImageChatAction
                                        text={Locale.Chat.Actions.Copy}
                                        onClick={() => {
                                          copyMessage(message);
                                          setActivePromptActionsId(null);
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                              {message.status === "loading" &&
                                !displayContent && (
                                  <div className={styles["message-meta"]}>
                                    {message.content ||
                                      Locale.ImageChat.Generating}
                                  </div>
                                )}
                              {displayImages.length > 0 && (
                                <div className={styles["image-grid"]}>
                                  {displayImages.map((image, index) =>
                                    (() => {
                                      const resource: ImageResource = {
                                        id: `${session.id}-${message.id}-${index}`,
                                        sessionId: session.id,
                                        messageId: message.id,
                                        imageIndex: index,
                                        image,
                                        topic: session.topic,
                                        createdAt: message.createdAt,
                                        kind:
                                          message.role === "assistant"
                                            ? "generated"
                                            : "reference",
                                      };

                                      return (
                                        <ImageResult
                                          key={`${message.id}-${index}`}
                                          resource={resource}
                                          onOpen={setSelectedImage}
                                        />
                                      );
                                    })(),
                                  )}
                                  {Array.from({ length: deletedImages }).map(
                                    (_, index) => (
                                      <div
                                        key={`${message.id}-deleted-${index}`}
                                        className={styles["deleted-image"]}
                                      >
                                        图片已删除
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                              {displayImages.length === 0 &&
                                deletedImages > 0 && (
                                  <div className={styles["deleted-image"]}>
                                    图片已删除
                                  </div>
                                )}
                              <div
                                className={clsx(styles["message-footer"], {
                                  [styles["message-footer-with-model"]]:
                                    message.model &&
                                    message.status !== "loading",
                                })}
                              >
                                {message.model &&
                                  message.status !== "loading" && (
                                    <span className={styles["message-meta"]}>
                                      {message.model}
                                    </span>
                                  )}
                                <span
                                  className={clsx(
                                    chatStyles["chat-message-action-date"],
                                    styles["message-date"],
                                  )}
                                >
                                  {new Date(message.createdAt).toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    },
                  )
                )}
              </div>
            </div>

            <div className={chatStyles["chat-input-panel"]}>
              <div className={styles["image-options"]}>
                <div
                  className={styles["image-settings"]}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className={styles["image-settings-toggle"]}
                    aria-expanded={showImageSettings}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowImageSettings((value) => !value);
                    }}
                  >
                    <span>生图设置</span>
                    <span className={styles["image-settings-arrow"]}>
                      {showImageSettings ? "^" : "v"}
                    </span>
                  </button>
                  {showImageSettings && (
                    <div className={styles["image-settings-panel"]}>
                      <div className={styles["image-settings-row"]}>
                        <label className={styles.option}>
                          <span>生图类型</span>
                          <ModelSelector
                            value={engine}
                            options={[...IMAGE_ENGINE_OPTIONS]}
                            placeholder="Nanobanana"
                            ariaLabel="生图类型"
                            onSelect={(value) =>
                              updateEngine(value as ImageEngine)
                            }
                          />
                        </label>
                        <div className={styles.option}>
                          <span>收藏提示词</span>
                          <button
                            type="button"
                            className={styles["favorite-prompts-button"]}
                            onClick={openFavoritePrompts}
                          >
                            查看收藏
                          </button>
                        </div>
                      </div>
                      <label className={styles.option}>
                        <span>生图模型</span>
                        <ModelSelector
                          value={model}
                          options={modelOptions}
                          placeholder={getDefaultImageModel()}
                          ariaLabel="生图模型"
                          onSelect={updateModel}
                          onAdd={addModelOption}
                          onDelete={deleteModelOption}
                        />
                      </label>
                    </div>
                  )}
                </div>
                <label className={styles.option}>
                  <span>{Locale.ImageChat.Size}</span>
                  <ModelSelector
                    value={size}
                    options={IMAGE_RATIO_OPTIONS}
                    placeholder="1:1"
                    displayNames={{ "": "原图比例" }}
                    ariaLabel={Locale.ImageChat.Size}
                    onSelect={setSize}
                  />
                </label>
                <label className={styles.option}>
                  <span>{Locale.ImageChat.Count}</span>
                  <ImageCountStepper value={count} onChange={setCount} />
                </label>
              </div>
              <div
                className={clsx(
                  chatStyles["chat-input-panel-inner"],
                  styles["image-input-panel-inner"],
                )}
              >
                {(attachImages.length > 0 || uploading) && (
                  <div className={styles["image-attach-strip"]}>
                    {attachImages.map((image, index) => (
                      <div
                        key={`${image}-${index}`}
                        className={styles["image-attach-preview"]}
                        style={{ backgroundImage: `url("${image}")` }}
                      >
                        <button
                          type="button"
                          aria-label="删除图片"
                          onClick={() =>
                            setAttachImages((images) =>
                              images.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    ))}
                    {uploading && (
                      <div className={styles["image-attach-loading"]}>
                        <LoadingButtonIcon />
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  className={styles["image-upload-button"]}
                  onClick={uploadImage}
                  disabled={uploading || generating}
                >
                  {uploading ? <LoadingButtonIcon /> : <ImageIcon />}
                  <span>{uploading ? "上传中" : "上传图片"}</span>
                </button>
                <textarea
                  ref={inputRef}
                  className={chatStyles["chat-input"]}
                  placeholder={Locale.ImageChat.Prompt}
                  value={prompt}
                  rows={3}
                  onChange={(e) => setPrompt(e.currentTarget.value)}
                  onPaste={handlePasteImage}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendPrompt();
                    }
                  }}
                />
                <IconButton
                  icon={<SendWhiteIcon />}
                  text={Locale.ImageChat.Send}
                  type="primary"
                  disabled={
                    generating || prompt.trim().length === 0 || !hasImageModel
                  }
                  className={chatStyles["chat-input-send"]}
                  onClick={() => sendPrompt()}
                />
              </div>
            </div>
          </div>
          {showFavoritePrompts && (
            <div
              className="modal-mask"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setShowFavoritePrompts(false);
                }
              }}
            >
              <Modal
                title="收藏提示词"
                showMaxButton={false}
                onClose={() => setShowFavoritePrompts(false)}
              >
                <div className={styles["favorite-prompts-modal"]}>
                  <div className={styles["favorite-prompt-add-row"]}>
                    <textarea
                      ref={favoritePromptInputRef}
                      value={favoritePromptDraft}
                      rows={1}
                      placeholder="新增收藏提示词"
                      onChange={(event) => {
                        setFavoritePromptDraft(event.currentTarget.value);
                        resizeFavoritePromptInput(event.currentTarget);
                      }}
                    />
                    <button
                      type="button"
                      aria-label="添加收藏提示词"
                      title="添加收藏提示词"
                      disabled={!favoritePromptDraft.trim()}
                      onClick={addFavoritePromptFromDraft}
                    >
                      +
                    </button>
                  </div>
                  {favoritePrompts.length === 0 ? (
                    <div className={styles["favorite-prompts-empty"]}>
                      暂无收藏提示词
                    </div>
                  ) : (
                    favoritePrompts.map((item) => (
                      <div
                        key={item.id}
                        className={styles["favorite-prompt-item"]}
                      >
                        <button
                          type="button"
                          className={styles["favorite-prompt-content"]}
                          onClick={() => applyFavoritePrompt(item.content)}
                        >
                          {item.content}
                        </button>
                        <button
                          type="button"
                          className={styles["favorite-prompt-delete"]}
                          aria-label={`删除提示词 ${item.content}`}
                          onClick={() =>
                            imageChatStore.deleteFavoritePrompt(item.id)
                          }
                        >
                          删除
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </Modal>
            </div>
          )}
          {selectedImage && (
            <ImagePreviewModal
              resource={selectedImage}
              resources={
                selectedImage.kind === "reference"
                  ? [selectedImage]
                  : sessionImageResources
              }
              currentResourceId={selectedImage.id}
              onSelect={setSelectedImage}
              onClose={() => setSelectedImage(undefined)}
              onDelete={(resource) => {
                imageChatStore.deleteImage(
                  resource.sessionId,
                  resource.messageId,
                  resource.image,
                );
                setSelectedImage(undefined);
              }}
            />
          )}
        </WindowContent>
      )}
    </>
  );
}
