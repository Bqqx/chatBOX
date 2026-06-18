import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const COMPLETION_CHANNEL_ID = "chatbox-completion";

let permissionPromise: Promise<boolean> | undefined;
let channelReady = false;

function isNativeApp() {
  return Capacitor.isNativePlatform();
}

async function ensureNotificationChannel() {
  if (channelReady || !isNativeApp()) return;

  try {
    await LocalNotifications.createChannel({
      id: COMPLETION_CHANNEL_ID,
      name: "完成提醒",
      description: "聊天和生图完成提醒",
      importance: 4,
      visibility: 1,
    });
    channelReady = true;
  } catch (error) {
    console.warn("[Notification] failed to create channel", error);
  }
}

export function isAppVisible() {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

export async function ensureCompletionNotificationPermission() {
  if (!isNativeApp()) return false;

  if (!permissionPromise) {
    permissionPromise = (async () => {
      try {
        const current = await LocalNotifications.checkPermissions();
        if (current.display === "granted") {
          await ensureNotificationChannel();
          return true;
        }

        const requested = await LocalNotifications.requestPermissions();
        const granted = requested.display === "granted";
        if (granted) {
          await ensureNotificationChannel();
        }
        return granted;
      } catch (error) {
        console.warn("[Notification] permission unavailable", error);
        return false;
      }
    })();
  }

  return permissionPromise;
}

export async function notifyCompletionWhenBackground() {
  if (!isNativeApp() || isAppVisible()) return;

  const granted = await ensureCompletionNotificationPermission();
  if (!granted) return;

  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Date.now() % 2147483647,
          title: "ChatBox",
          body: "已完成",
          channelId: COMPLETION_CHANNEL_ID,
        },
      ],
    });
  } catch (error) {
    console.warn("[Notification] failed to schedule", error);
  }
}
