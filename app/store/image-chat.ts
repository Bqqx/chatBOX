import { nanoid } from "nanoid";

import Locale from "../locales";
import { StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import { showToast } from "../components/ui-lib";

export type ImageChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  deletedImages?: number;
  hidden?: boolean;
  status?: "loading" | "error";
  createdAt: number;
  model?: string;
};

export interface ImageChatSession {
  id: string;
  topic: string;
  messages: ImageChatMessage[];
  lastUpdate: number;
}

export function createImageMessage(
  override: Partial<ImageChatMessage>,
): ImageChatMessage {
  return {
    id: nanoid(),
    role: "user",
    content: "",
    createdAt: Date.now(),
    ...override,
  };
}

function createEmptyImageSession(): ImageChatSession {
  return {
    id: nanoid(),
    topic: Locale.ImageChat.NewChat,
    messages: [],
    lastUpdate: Date.now(),
  };
}

function trimImageTopic(prompt: string) {
  const topic = prompt.trim().replace(/\s+/g, " ");
  return topic.length > 18 ? `${topic.slice(0, 18)}...` : topic;
}

const DEFAULT_IMAGE_CHAT_STATE = {
  sessions: [createEmptyImageSession()],
  archivedSessions: [] as ImageChatSession[],
  currentSessionIndex: 0,
};

export const useImageChatStore = createPersistStore(
  DEFAULT_IMAGE_CHAT_STATE,
  (set, _get) => {
    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    const methods = {
      clearSessions() {
        set(() => ({
          sessions: [createEmptyImageSession()],
          currentSessionIndex: 0,
        }));
      },

      selectSession(index: number) {
        if (index === get().currentSessionIndex) return;
        set({ currentSessionIndex: index });
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;
          const newSessions = [...sessions];
          const session = newSessions[from];

          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });
      },

      newSession() {
        set((state) => ({
          currentSessionIndex: 0,
          sessions: [createEmptyImageSession(), ...state.sessions],
        }));
      },

      nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      deleteSession(index: number) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - Number(index < currentIndex),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          sessions.push(createEmptyImageSession());
        }

        set(() => ({
          currentSessionIndex: nextIndex,
          sessions,
          archivedSessions: [deletedSession, ...(get().archivedSessions ?? [])],
        }));

        showToast(
          "已归档对话",
          {
            text: "恢复",
            onClick() {
              get().restoreArchivedSession("image", deletedSession.id);
            },
          },
          5000,
        );
      },

      restoreArchivedSession(_type: "image", sessionId: string) {
        const archivedSessions = get().archivedSessions ?? [];
        const session = archivedSessions.find((item) => item.id === sessionId);
        if (!session) return;

        set((state) => ({
          archivedSessions: (state.archivedSessions ?? []).filter(
            (item) => item.id !== sessionId,
          ),
          sessions: [session, ...state.sessions],
          currentSessionIndex: 0,
        }));
      },

      deleteArchivedSession(_type: "image", sessionId: string) {
        set((state) => ({
          archivedSessions: (state.archivedSessions ?? []).filter(
            (item) => item.id !== sessionId,
          ),
        }));
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }

        return sessions[index];
      },

      addMessages(messages: ImageChatMessage[]) {
        const session = get().currentSession();
        get().updateTargetSession(session, (session) => {
          if (session.messages.length === 0) {
            const firstUserMessage = messages.find((m) => m.role === "user");
            if (firstUserMessage?.content) {
              session.topic = trimImageTopic(firstUserMessage.content);
            }
          }
          session.messages = session.messages.concat(messages);
          session.lastUpdate = Date.now();
        });
      },

      updateMessage(
        sessionId: string,
        messageId: string,
        updater: (message: ImageChatMessage) => void,
      ) {
        const sessions = get().sessions;
        const sessionIndex = sessions.findIndex(
          (item) => item.id === sessionId,
        );
        const session = sessions[sessionIndex];
        const messageIndex =
          session?.messages.findIndex((item) => item.id === messageId) ?? -1;

        if (!session || messageIndex < 0) return;

        const message = { ...session.messages[messageIndex] };
        updater(message);
        const messages = [...session.messages];
        messages[messageIndex] = message;
        const nextSessions = [...sessions];
        nextSessions[sessionIndex] = {
          ...session,
          messages,
          lastUpdate: Date.now(),
        };
        set(() => ({ sessions: nextSessions }));
      },

      deleteImage(sessionId: string, messageId: string, imageSrc: string) {
        const sessions = get().sessions;
        const sessionIndex = sessions.findIndex(
          (item) => item.id === sessionId,
        );
        const session = sessions[sessionIndex];
        const messageIndex =
          session?.messages.findIndex((item) => item.id === messageId) ?? -1;

        if (!session || messageIndex < 0) return;

        const message = { ...session.messages[messageIndex] };
        const images = [...(message.images ?? [])];
        const imageIndex = images.indexOf(imageSrc);

        if (imageIndex >= 0) {
          images.splice(imageIndex, 1);
          message.images = images;
        } else if (message.content.includes(imageSrc)) {
          message.content = message.content.split(imageSrc).join("");
        } else {
          return;
        }

        message.deletedImages = (message.deletedImages ?? 0) + 1;

        const messages = [...session.messages];
        messages[messageIndex] = message;
        const nextSessions = [...sessions];
        nextSessions[sessionIndex] = {
          ...session,
          messages,
          lastUpdate: Date.now(),
        };
        set(() => ({ sessions: nextSessions }));
      },

      updateTargetSession(
        targetSession: ImageChatSession,
        updater: (session: ImageChatSession) => void,
      ) {
        const sessions = get().sessions;
        const index = sessions.findIndex((s) => s.id === targetSession.id);
        if (index < 0) return;
        const nextSession = { ...sessions[index] };
        updater(nextSession);
        const nextSessions = [...sessions];
        nextSessions[index] = nextSession;
        set(() => ({ sessions: nextSessions }));
      },
    };

    return methods;
  },
  {
    name: StoreKey.ImageChat,
    version: 1,
  },
);
