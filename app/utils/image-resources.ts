import { ImageChatSession } from "../store/image-chat";

export type ImageResource = {
  id: string;
  sessionId: string;
  messageId: string;
  imageIndex: number;
  image: string;
  topic: string;
  createdAt: number;
};

export type ImageResourceTimeFilter = "all" | "today" | "week";

export function normalizeDataImageUrl(input: string) {
  const match = input.match(
    /data:(image\/[a-zA-Z+.-]+);base64,([\sA-Za-z0-9+/=]+)/,
  );
  if (!match) return input;

  return `data:${match[1]};base64,${match[2].replace(/\s+/g, "")}`;
}

export function extractImagesFromText(text: string) {
  const markdownImageRegex =
    /!\[[^\]]*]\s*\(\s*(data:image\/[a-zA-Z+.-]+;base64,[\s\S]*?|https?:\/\/[^)\s]+)\s*\)/g;
  const htmlImageRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  const dataImageRegex = /data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+/g;
  const urls: string[] = [];

  for (const match of text.matchAll(markdownImageRegex)) {
    urls.push(normalizeDataImageUrl(match[1]));
  }
  for (const match of text.matchAll(htmlImageRegex)) {
    urls.push(normalizeDataImageUrl(match[1]));
  }
  urls.push(...(text.match(dataImageRegex) ?? []).map(normalizeDataImageUrl));

  return urls;
}

export function getImageResources(sessions: ImageChatSession[]) {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) => {
      const images = Array.from(
        new Set([
          ...(message.images ?? []),
          ...extractImagesFromText(message.content),
        ]),
      );

      return images.map((image, imageIndex) => ({
        id: `${session.id}-${message.id}-${imageIndex}`,
        sessionId: session.id,
        messageId: message.id,
        imageIndex,
        image,
        topic: session.topic,
        createdAt: message.createdAt,
      }));
    }),
  );
}

export function getImageResourceTimeFilter(createdAt: number) {
  const created = new Date(createdAt);
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = now.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - mondayOffset,
  ).getTime();

  if (created.getTime() >= todayStart) return "today";
  if (created.getTime() >= weekStart) return "week";

  return "all";
}

export function filterImageResources(
  resources: ImageResource[],
  options: { sessionId?: string | null; time?: ImageResourceTimeFilter },
) {
  const time = options.time ?? "all";

  return resources.filter((resource) => {
    if (options.sessionId && resource.sessionId !== options.sessionId) {
      return false;
    }

    if (time === "all") return true;
    const resourceTimeFilter = getImageResourceTimeFilter(resource.createdAt);
    return time === "today"
      ? resourceTimeFilter === "today"
      : resourceTimeFilter === "today" || resourceTimeFilter === "week";
  });
}
