"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import chatStyles from "./chat.module.scss";
import homeStyles from "./home.module.scss";
import styles from "./image-chat.module.scss";

import { IconButton } from "./button";
import { SideBar } from "./sidebar";
import { WindowContent } from "./home";
import Locale from "../locales";
import { Path } from "../constant";
import { normalizeApiBaseUrl } from "../client/api";
import { getClientConfig } from "../config/client";
import {
  createImageMessage,
  useAccessStore,
  useAppConfig,
  useImageChatStore,
} from "../store";
import { copyToClipboard, useMobileScreen } from "../utils";
import { ImagePreviewModal } from "./image-preview";
import { Modal, showPrompt, showToast } from "./ui-lib";
import { ImageResource } from "../utils/image-resources";

import ReturnIcon from "../icons/return.svg";
import SendWhiteIcon from "../icons/send-white.svg";
import RenameIcon from "../icons/rename.svg";
import MinIcon from "../icons/min.svg";
import MaxIcon from "../icons/max.svg";

import { useLocation, useNavigate } from "react-router-dom";

const IMAGE_RATIO_OPTIONS = [
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

const NANO_MODEL_ALIASES: Record<string, string> = {
  "[Rim] gemini-3-pro-image-preview": "「Rim」gemini-3-pro-image-preview",
};

function normalizeRelayModelName(engine: ImageEngine, model: string) {
  const name = model.trim();
  if (engine !== "Nanobanana") return name;
  return NANO_MODEL_ALIASES[name] ?? name;
}

function getDefaultImageModel(engine: ImageEngine) {
  return engine === "Nanobanana"
    ? "「Rim」gemini-3-pro-image-preview"
    : "gpt-image-2";
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

  return getDefaultImageModel(engine);
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
    getDefaultImageModel(engine),
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

function buildGenerateContentEndpoint(baseUrl: string, model: string) {
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);
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
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);
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

function buildGenerateContentPayload(prompt: string, size: string) {
  const imageConfig = sizeToGeminiImageConfig(size);
  const promptWithParams = `${prompt} [分辨率: ${imageConfig.imageSize}, 比例: ${imageConfig.aspectRatio}]`;

  return {
    contents: [
      {
        role: "user",
        parts: [{ text: promptWithParams }],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig,
    },
  };
}

function ratioToOpenAIImageSize(ratio: string) {
  const presets: Record<string, string> = {
    "1:1": "1024x1024",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
    "9:16": "1152x2048",
    "16:9": "2048x1152",
    "3:4": "1536x2048",
    "4:3": "2048x1536",
    "4:5": "1536x1920",
    "5:4": "1920x1536",
    "21:9": "2688x1152",
  };

  return presets[ratio] ?? "1024x1024";
}

function buildOpenAIImagePayload(
  model: string,
  prompt: string,
  ratio: string,
  count: number,
) {
  return {
    model,
    prompt,
    size: ratioToOpenAIImageSize(ratio),
    quality: "high",
    n: count,
  };
}

function buildNanoBananaPayload(prompt: string, size: string) {
  const imageConfig = sizeToGeminiImageConfig(size);
  const promptWithParams = `${prompt} [分辨率: ${imageConfig.imageSize}, 比例: ${imageConfig.aspectRatio}]`;

  return {
    contents: [
      {
        role: "user",
        parts: [{ text: promptWithParams }],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig,
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
  const [imageUrl, setImageUrl] = useState(image);

  useEffect(() => {
    if (!image.startsWith("data:image/")) {
      setImageUrl(image);
      return;
    }

    setImageUrl(image);
    const buildBlobUrl = () => setImageUrl(dataUrlToBlobUrl(image));
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(buildBlobUrl, {
        timeout: 1200,
      });
      return () => window.cancelIdleCallback(idleId);
    }

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
        props.onOpen(resource);
      }}
    >
      <img
        className={styles["image-result"]}
        src={imageUrl}
        alt={Locale.ImageChat.Title}
      />
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
  onSelect: (value: string) => void;
  onAdd?: (value: string) => void;
  onDelete?: (value: string) => void;
}) {
  const selectorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [newModel, setNewModel] = useState("");
  const currentModel = props.value || props.placeholder;
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
        <span>{currentModel}</span>
        <span className={styles["model-selector-arrow"]}>v</span>
      </button>
      {open && (
        <div className={styles["model-selector-menu"]}>
          <div className={styles["model-selector-list"]}>
            {props.options.map((model) => (
              <div
                key={model}
                className={clsx(styles["model-selector-option"], {
                  [styles["model-selector-option-active"]]:
                    model === currentModel,
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
                  {model}
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
) {
  const requestOptions = {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  };

  let json: any = {};
  let response: Response | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    response = await fetchWithTimeout(requestUrl, requestOptions);
    json = await readResponseJson(response);

    if (!response.ok && RETRYABLE_STATUS.has(response.status) && attempt < 2) {
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
  const config = useAppConfig();
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
  const [selectedImage, setSelectedImage] = useState<
    ImageResource | undefined
  >();
  const [activePromptActionsId, setActivePromptActionsId] = useState<
    string | null
  >(null);
  const [showFavoritePrompts, setShowFavoritePrompts] = useState(false);
  const [showImageSettings, setShowImageSettings] = useState(false);
  const favoritePrompts = imageChatStore.favoritePrompts ?? [];
  const showMobileDetail =
    !isMobileScreen || (location.state as { showDetail?: boolean })?.showDetail;
  const sessionImageResources = useMemo(
    () =>
      messages.flatMap((message) => {
        const displayImages = normalizeImageSources(
          message.images && message.images.length > 0
            ? message.images
            : extractImageUrlsFromText(message.content),
        );

        return displayImages.map((image, index) => ({
          id: `${session.id}-${message.id}-${index}`,
          sessionId: session.id,
          messageId: message.id,
          imageIndex: index,
          image,
          topic: session.topic,
          createdAt: message.createdAt,
        }));
      }),
    [messages, session.id, session.topic],
  );

  const canUseImageRelay = useMemo(() => {
    return (
      accessStore.imageUrl.trim().length > 0 &&
      accessStore.imageApiKey.trim().length > 0
    );
  }, [accessStore.imageApiKey, accessStore.imageUrl]);

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
    if (!isCrossEngineModel(engine, model)) return;
    const nextModel = getStoredImageModel(accessStore, engine);
    setModel(nextModel);
    accessStore.update((access) => {
      access.imageModel = nextModel;
      if (engine === "Nanobanana") {
        access.imageNanoModel = nextModel;
      } else {
        access.imageChatGPTModel = nextModel;
      }
    });
  }, [accessStore, engine, model]);

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
    const fallback = nextOptions[0] ?? getDefaultImageModel(engine);
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

  function applyFavoritePrompt(content: string) {
    setPrompt(content);
    setShowFavoritePrompts(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function sendPrompt(promptText = prompt, clearInput = true) {
    const text = promptText.trim();
    if (!text || generating) return;

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
    const activeEngine = engine;
    const activeModel = normalizeRelayModelName(
      activeEngine,
      !isCrossEngineModel(activeEngine, model)
        ? model
        : getStoredImageModel(accessStore, activeEngine),
    );
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
    }
    setGenerating(true);

    try {
      const baseUrl = normalizeApiBaseUrl(accessStore.imageUrl);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessStore.imageApiKey.trim()}`,
      };
      if (!getClientConfig()?.isApp && baseUrl.startsWith("http")) {
        headers["x-base-url"] = baseUrl;
      }

      const targetCount = clampImageCount(count);
      const images: string[] = [];
      const errors: string[] = [];

      if (activeEngine === "ChatGPT") {
        const json = await postJsonWithRetry(
          buildOpenAIImageEndpoint(accessStore.imageUrl),
          headers,
          buildOpenAIImagePayload(activeModel, text, size, targetCount),
        );
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
          },
        );
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
            headers,
            buildNanoBananaPayload(text, size),
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
      });
    } catch (error) {
      const message = getErrorMessage(error);
      imageChatStore.updateMessage(targetSessionId, assistantId, (item) => {
        item.content = message;
        item.status = "error";
      });
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
                {!isMobileScreen && (
                  <div className="window-action-button">
                    <IconButton
                      icon={<RenameIcon />}
                      bordered
                      title={Locale.Chat.EditMessage.Title}
                      aria={Locale.Chat.EditMessage.Title}
                      onClick={updateSessionTopic}
                    />
                  </div>
                )}
                {!isMobileScreen && (
                  <div className="window-action-button">
                    <IconButton
                      aria={Locale.Chat.Actions.FullScreen}
                      icon={config.tightBorder ? <MinIcon /> : <MaxIcon />}
                      bordered
                      onClick={() => {
                        config.update(
                          (config) =>
                            (config.tightBorder = !config.tightBorder),
                        );
                      }}
                    />
                  </div>
                )}
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
                    const deletedImages = message.deletedImages ?? 0;
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
                            })}
                          >
                            {(displayContent || message.status === "error") && (
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
                                          setActivePromptActionsId((current) =>
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
                                {displayImages.map((image, index) => (
                                  <ImageResult
                                    key={`${message.id}-${index}`}
                                    resource={{
                                      id: `${session.id}-${message.id}-${index}`,
                                      sessionId: session.id,
                                      messageId: message.id,
                                      imageIndex: index,
                                      image,
                                      topic: session.topic,
                                      createdAt: message.createdAt,
                                    }}
                                    onOpen={setSelectedImage}
                                  />
                                ))}
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
                                  message.model && message.status !== "loading",
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
                  })
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
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setShowImageSettings((value) => !value);
                      }
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
                            onClick={() => setShowFavoritePrompts(true)}
                          >
                            收藏提示词
                          </button>
                        </div>
                      </div>
                      <label className={styles.option}>
                        <span>生图模型</span>
                        <ModelSelector
                          value={model}
                          options={modelOptions}
                          placeholder={getDefaultImageModel(engine)}
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
                    ariaLabel={Locale.ImageChat.Size}
                    onSelect={setSize}
                  />
                </label>
                <label className={styles.option}>
                  <span>{Locale.ImageChat.Count}</span>
                  <input
                    className={styles["image-count-input"]}
                    type="number"
                    min={1}
                    max={4}
                    value={count}
                    onChange={(e) =>
                      setCount(
                        clampImageCount(
                          Number.parseInt(e.currentTarget.value) || 1,
                        ),
                      )
                    }
                  />
                </label>
              </div>
              <div className={chatStyles["chat-input-panel-inner"]}>
                <textarea
                  ref={inputRef}
                  className={chatStyles["chat-input"]}
                  placeholder={Locale.ImageChat.Prompt}
                  value={prompt}
                  rows={3}
                  onChange={(e) => setPrompt(e.currentTarget.value)}
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
                  disabled={generating || prompt.trim().length === 0}
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
                onClose={() => setShowFavoritePrompts(false)}
              >
                <div className={styles["favorite-prompts-modal"]}>
                  {favoritePrompts.length === 0 ? (
                    <div className={styles["favorite-prompts-empty"]}>
                      暂无收藏提示词
                    </div>
                  ) : (
                    favoritePrompts.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={styles["favorite-prompt-item"]}
                        onClick={() => applyFavoritePrompt(item.content)}
                      >
                        {item.content}
                      </button>
                    ))
                  )}
                </div>
              </Modal>
            </div>
          )}
          {selectedImage && (
            <ImagePreviewModal
              resource={selectedImage}
              resources={sessionImageResources}
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
