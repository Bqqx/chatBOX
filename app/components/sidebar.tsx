import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";

import styles from "./home.module.scss";

import { IconButton } from "./button";
import SettingsIcon from "../icons/settings.svg";
import HistoryIcon from "../icons/history.svg";
import ReturnIcon from "../icons/return.svg";
import ChatBoxLogoIcon from "../icons/chatbox-logo.svg";
import AddIcon from "../icons/add.svg";
import DeleteIcon from "../icons/delete.svg";
import FileManagerIcon from "../icons/file-manager.svg";
import McpIcon from "../icons/mcp.svg";
import DragIcon from "../icons/drag.svg";
import ImageIcon from "../icons/image.svg";
import ChatIcon from "../icons/chat.svg";

import Locale from "../locales";

import { useAppConfig, useChatStore, useImageChatStore } from "../store";
import {
  filterImageResources,
  getImageResources,
} from "../utils/image-resources";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  NARROW_SIDEBAR_WIDTH,
  Path,
} from "../constant";

import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { isIOS, useMobileScreen } from "../utils";
import dynamic from "next/dynamic";
import { Modal, showConfirm } from "./ui-lib";
import clsx from "clsx";
import { isMcpEnabled } from "../mcp/actions";

const ChatList = dynamic(async () => (await import("./chat-list")).ChatList, {
  loading: () => null,
});
const ImageChatList = dynamic(
  async () => (await import("./chat-list")).ImageChatList,
  {
    loading: () => null,
  },
);

function ArchiveManagerModal(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const imageChatStore = useImageChatStore();
  const chatArchived = chatStore.archivedSessions ?? [];
  const imageArchived = imageChatStore.archivedSessions ?? [];
  const total = chatArchived.length + imageArchived.length;

  const deleteArchived = async (type: "chat" | "image", id: string) => {
    if (await showConfirm("确定要彻底删除这个归档对话吗？")) {
      if (type === "chat") {
        chatStore.deleteArchivedSession("chat", id);
      } else {
        imageChatStore.deleteArchivedSession("image", id);
      }
    }
  };

  const restoreArchived = (type: "chat" | "image", id: string) => {
    if (type === "chat") {
      chatStore.restoreArchivedSession("chat", id);
    } else {
      imageChatStore.restoreArchivedSession("image", id);
    }
  };

  const renderSection = (
    title: string,
    type: "chat" | "image",
    sessions: typeof chatArchived | typeof imageArchived,
  ) => (
    <div className={styles["archive-section"]}>
      <div className={styles["archive-section-title"]}>
        {title} · {sessions.length}
      </div>
      {sessions.length === 0 ? (
        <div className={styles["archive-empty-line"]}>暂无归档对话</div>
      ) : (
        sessions.map((session) => (
          <div className={styles["archive-item"]} key={`${type}-${session.id}`}>
            <div className={styles["archive-item-main"]}>
              <div className={styles["archive-item-title"]}>
                {session.topic}
              </div>
              <div className={styles["archive-item-info"]}>
                {type === "chat" ? "聊天" : "生图"} · {session.messages.length}{" "}
                条对话 · {new Date(session.lastUpdate).toLocaleString()}
              </div>
            </div>
            <div className={styles["archive-item-actions"]}>
              <IconButton
                icon={<ReturnIcon />}
                text="恢复"
                bordered
                onClick={() => restoreArchived(type, session.id)}
              />
              <IconButton
                icon={<DeleteIcon />}
                text="删除"
                type="danger"
                bordered
                onClick={() => deleteArchived(type, session.id)}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div
      className="modal-mask"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <Modal title="归档管理" onClose={props.onClose}>
        <div className={styles["archive-manager"]}>
          <div className={styles["archive-summary"]}>共 {total} 个归档对话</div>
          {renderSection("聊天", "chat", chatArchived)}
          {renderSection("生图", "image", imageArchived)}
        </div>
      </Modal>
    </div>
  );
}

export function useHotKey(mode: "chat" | "image" | "resource" = "chat") {
  const chatStore = useChatStore();
  const imageChatStore = useImageChatStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey) {
        if (mode === "resource") return;

        if (e.key === "ArrowUp") {
          if (mode === "chat") {
            chatStore.nextSession(-1);
          } else {
            imageChatStore.nextSession(-1);
          }
        } else if (e.key === "ArrowDown") {
          if (mode === "chat") {
            chatStore.nextSession(1);
          } else {
            imageChatStore.nextSession(1);
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}

function ResourcePanelItem(props: {
  title: string;
  count: number;
  selected: boolean;
  onClick: () => void;
  narrow?: boolean;
  narrowLabel?: string;
}) {
  if (props.narrow) {
    return (
      <div
        className={clsx(styles["chat-item"], styles["resource-item-narrow"], {
          [styles["chat-item-selected"]]: props.selected,
        })}
        onClick={props.onClick}
        title={`${props.title}\n${props.count} 张图片`}
      >
        {props.narrowLabel ??
          Array.from(props.title.trim()).slice(0, 2).join("")}
      </div>
    );
  }

  return (
    <div
      className={clsx(styles["chat-item"], {
        [styles["chat-item-selected"]]: props.selected,
      })}
      onClick={props.onClick}
      title={`${props.title}\n${props.count} 张图片`}
    >
      <div className={styles["chat-item-title"]}>{props.title}</div>
      <div className={styles["chat-item-info"]}>
        <div className={styles["chat-item-count"]}>{props.count} 张图片</div>
      </div>
    </div>
  );
}

function ResourcePanel(props: { narrow?: boolean }) {
  const imageChatStore = useImageChatStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resources = useMemo(
    () => getImageResources(imageChatStore.sessions),
    [imageChatStore.sessions],
  );
  const sessionId = searchParams.get("session");
  const timeParam = searchParams.get("time");
  const activeTime =
    timeParam === "today" || timeParam === "week" ? timeParam : "all";

  const todayCount = filterImageResources(resources, { time: "today" }).length;
  const weekCount = filterImageResources(resources, { time: "week" }).length;
  const sessionsWithImages = imageChatStore.sessions
    .map((session) => ({
      session,
      count: resources.filter((resource) => resource.sessionId === session.id)
        .length,
    }))
    .filter((item) => item.count > 0);

  const goTo = (search: string) => {
    navigate(`${Path.Resources}${search}`);
  };
  const getNarrowLabel = (title: string) =>
    Array.from(title.trim()).slice(0, 2).join("");

  return (
    <div className={styles["resource-panel"]}>
      <ResourcePanelItem
        title="全部图片"
        count={resources.length}
        selected={!sessionId && activeTime === "all"}
        onClick={() => goTo("")}
        narrow={props.narrow}
        narrowLabel="全部"
      />
      <ResourcePanelItem
        title="今天"
        count={todayCount}
        selected={!sessionId && activeTime === "today"}
        onClick={() => goTo("?time=today")}
        narrow={props.narrow}
        narrowLabel="今天"
      />
      <ResourcePanelItem
        title="本周"
        count={weekCount}
        selected={!sessionId && activeTime === "week"}
        onClick={() => goTo("?time=week")}
        narrow={props.narrow}
        narrowLabel="本周"
      />

      {sessionsWithImages.length > 0 && !props.narrow && (
        <div className={styles["resource-panel-title"]}>生图对话来源</div>
      )}
      {sessionsWithImages.map(({ session, count }) => (
        <ResourcePanelItem
          key={session.id}
          title={session.topic}
          count={count}
          selected={sessionId === session.id}
          onClick={() => goTo(`?session=${encodeURIComponent(session.id)}`)}
          narrow={props.narrow}
          narrowLabel={getNarrowLabel(session.topic)}
        />
      ))}
    </div>
  );
}

export function useDragSideBar() {
  const limit = (x: number) => Math.min(MAX_SIDEBAR_WIDTH, x);

  const config = useAppConfig();
  const startX = useRef(0);
  const startDragWidth = useRef(config.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  const latestClientX = useRef(0);
  const dragFrame = useRef<number>();
  const hasDragged = useRef(false);

  const toggleSideBar = () => {
    config.update((config) => {
      if (config.sidebarWidth < MIN_SIDEBAR_WIDTH) {
        config.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
      } else {
        config.sidebarWidth = NARROW_SIDEBAR_WIDTH;
      }
    });
  };

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);

    startX.current = e.clientX;
    latestClientX.current = e.clientX;
    startDragWidth.current = config.sidebarWidth;
    hasDragged.current = false;
    const dragStartTime = Date.now();

    const applyDragWidth = () => {
      dragFrame.current = undefined;
      const d = latestClientX.current - startX.current;
      if (Math.abs(d) > 4) {
        hasDragged.current = true;
      }
      const nextWidth = limit(startDragWidth.current + d);
      config.update((config) => {
        if (nextWidth < MIN_SIDEBAR_WIDTH) {
          config.sidebarWidth = NARROW_SIDEBAR_WIDTH;
        } else {
          config.sidebarWidth = nextWidth;
        }
      });
    };

    const handleDragMove = (event: PointerEvent) => {
      event.preventDefault();
      latestClientX.current = event.clientX;
      if (dragFrame.current === undefined) {
        dragFrame.current = window.requestAnimationFrame(applyDragWidth);
      }
    };

    const handleDragEnd = () => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      window.removeEventListener("pointercancel", handleDragEnd);

      if (dragFrame.current !== undefined) {
        window.cancelAnimationFrame(dragFrame.current);
        dragFrame.current = undefined;
        applyDragWidth();
      }

      const shouldFireClick =
        !hasDragged.current && Date.now() - dragStartTime < 300;
      if (shouldFireClick) {
        toggleSideBar();
      }
    };

    window.addEventListener("pointermove", handleDragMove, { passive: false });
    window.addEventListener("pointerup", handleDragEnd);
    window.addEventListener("pointercancel", handleDragEnd);
  };

  const isMobileScreen = useMobileScreen();
  const shouldNarrow =
    !isMobileScreen && config.sidebarWidth < MIN_SIDEBAR_WIDTH;

  useEffect(() => {
    const barWidth = shouldNarrow
      ? NARROW_SIDEBAR_WIDTH
      : limit(config.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
    const sideBarWidth = isMobileScreen ? "100vw" : `${barWidth}px`;
    document.documentElement.style.setProperty("--sidebar-width", sideBarWidth);
  }, [config.sidebarWidth, isMobileScreen, shouldNarrow]);

  return {
    onDragStart,
    shouldNarrow,
  };
}

export function SideBarContainer(props: {
  children: React.ReactNode;
  onDragStart: (e: React.PointerEvent<HTMLDivElement>) => void;
  shouldNarrow: boolean;
  className?: string;
}) {
  const isMobileScreen = useMobileScreen();
  const isIOSMobile = useMemo(
    () => isIOS() && isMobileScreen,
    [isMobileScreen],
  );
  const { children, className, onDragStart, shouldNarrow } = props;
  return (
    <div
      className={clsx(styles.sidebar, className, {
        [styles["narrow-sidebar"]]: shouldNarrow,
      })}
      style={{
        // #3016 disable transition on ios mobile screen
        transition: isMobileScreen && isIOSMobile ? "none" : undefined,
      }}
    >
      {children}
      <div
        className={styles["sidebar-drag"]}
        onPointerDown={(e) => onDragStart(e as any)}
      >
        <DragIcon />
      </div>
    </div>
  );
}

export function SideBarHeader(props: {
  title?: string | React.ReactNode;
  subTitle?: string | React.ReactNode;
  logo?: React.ReactNode;
  children?: React.ReactNode;
  shouldNarrow?: boolean;
}) {
  const { title, subTitle, logo, children, shouldNarrow } = props;
  return (
    <Fragment>
      <div
        className={clsx(styles["sidebar-header"], {
          [styles["sidebar-header-narrow"]]: shouldNarrow,
        })}
        data-tauri-drag-region
      >
        <div className={styles["sidebar-title-container"]}>
          <div className={styles["sidebar-title"]} data-tauri-drag-region>
            {title}
          </div>
          <div className={styles["sidebar-sub-title"]}>{subTitle}</div>
        </div>
        <div className={clsx(styles["sidebar-logo"], "no-dark")}>{logo}</div>
      </div>
      {children}
    </Fragment>
  );
}

export function SideBarBody(props: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}) {
  const { onClick, children } = props;
  return (
    <div className={styles["sidebar-body"]} onClick={onClick}>
      {children}
    </div>
  );
}

export function SideBarTail(props: {
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}) {
  const { primaryAction, secondaryAction } = props;

  return (
    <div className={styles["sidebar-tail"]}>
      <div className={styles["sidebar-actions"]}>{primaryAction}</div>
      <div className={styles["sidebar-actions"]}>{secondaryAction}</div>
    </div>
  );
}

export function SideBar(props: {
  className?: string;
  mode?: "chat" | "image" | "resource";
}) {
  const mode = props.mode ?? "chat";
  useHotKey(mode);
  const { onDragStart, shouldNarrow } = useDragSideBar();
  const navigate = useNavigate();
  const location = useLocation();
  const config = useAppConfig();
  const isMobileScreen = useMobileScreen();
  const chatStore = useChatStore();
  const imageChatStore = useImageChatStore();
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [showArchiveManager, setShowArchiveManager] = useState(false);

  useEffect(() => {
    // 检查 MCP 是否启用
    const checkMcpStatus = async () => {
      const enabled = await isMcpEnabled();
      setMcpEnabled(enabled);
      console.log("[SideBar] MCP enabled:", enabled);
    };
    checkMcpStatus();
  }, []);

  const currentPath = location.pathname as Path;
  const isResourcesActive = currentPath === Path.Resources;
  const isChatActive = [Path.Home, Path.Chat, Path.NewChat].includes(
    currentPath,
  );
  const isImageActive = currentPath === Path.Sd;

  return (
    <SideBarContainer
      onDragStart={onDragStart}
      shouldNarrow={shouldNarrow}
      className={props.className}
    >
      {showArchiveManager && (
        <ArchiveManagerModal onClose={() => setShowArchiveManager(false)} />
      )}
      <SideBarHeader
        title="ChatBox"
        subTitle="把灵感、对话与图像装进一个智能工作舱。"
        logo={<ChatBoxLogoIcon />}
        shouldNarrow={shouldNarrow}
      >
        <div className={styles["sidebar-header-bar"]}>
          <IconButton
            icon={<FileManagerIcon />}
            text={shouldNarrow ? undefined : "资源管理"}
            className={clsx(styles["sidebar-bar-button"], {
              [styles["sidebar-bar-button-active"]]: isResourcesActive,
            })}
            onClick={() => {
              navigate(Path.Resources, { state: { fromHome: true } });
            }}
            shadow
          />
          {mcpEnabled && (
            <IconButton
              icon={<McpIcon />}
              text={shouldNarrow ? undefined : Locale.Mcp.Name}
              className={styles["sidebar-bar-button"]}
              onClick={() => {
                navigate(Path.McpMarket, { state: { fromHome: true } });
              }}
              shadow
            />
          )}
          <IconButton
            icon={<ChatIcon />}
            text={shouldNarrow ? undefined : Locale.ImageChat.ChatName}
            className={clsx(styles["sidebar-bar-button"], {
              [styles["sidebar-bar-button-active"]]: isChatActive,
            })}
            onClick={() => {
              navigate(isMobileScreen ? Path.Home : Path.Chat, {
                state: { fromHome: true },
              });
            }}
            shadow
          />
          <IconButton
            icon={<ImageIcon />}
            text={shouldNarrow ? undefined : Locale.ImageChat.Name}
            className={clsx(styles["sidebar-bar-button"], {
              [styles["sidebar-bar-button-active"]]: isImageActive,
            })}
            onClick={() => {
              navigate(Path.Sd, { state: { fromHome: true } });
            }}
            shadow
          />
        </div>
      </SideBarHeader>
      <SideBarBody
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            navigate(
              mode === "image"
                ? Path.Sd
                : mode === "resource"
                ? Path.Resources
                : Path.Home,
            );
          }
        }}
      >
        {mode === "resource" ? (
          <ResourcePanel narrow={shouldNarrow} />
        ) : mode === "image" ? (
          <ImageChatList narrow={shouldNarrow} />
        ) : (
          <ChatList narrow={shouldNarrow} />
        )}
      </SideBarBody>
      <SideBarTail
        primaryAction={
          <>
            <div className={styles["sidebar-action"]}>
              <IconButton
                aria="归档管理"
                title="归档管理"
                icon={<HistoryIcon />}
                shadow
                onClick={() => setShowArchiveManager(true)}
              />
            </div>
            <div className={styles["sidebar-action"]}>
              <Link to={Path.Settings}>
                <IconButton
                  aria={Locale.Settings.Title}
                  icon={<SettingsIcon />}
                  shadow
                />
              </Link>
            </div>
          </>
        }
        secondaryAction={
          mode === "resource" ? null : (
            <IconButton
              icon={<AddIcon />}
              text={
                shouldNarrow
                  ? undefined
                  : mode === "image"
                  ? Locale.ImageChat.NewChat
                  : Locale.Home.NewChat
              }
              onClick={() => {
                if (mode === "image") {
                  imageChatStore.newSession();
                  navigate(Path.Sd, { state: { showDetail: true } });
                } else if (config.dontShowMaskSplashScreen) {
                  chatStore.newSession();
                  navigate(Path.Chat);
                } else {
                  navigate(Path.NewChat);
                }
              }}
              shadow
            />
          )
        }
      />
    </SideBarContainer>
  );
}
