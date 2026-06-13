import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";

import styles from "./home.module.scss";

import { IconButton } from "./button";
import SettingsIcon from "../icons/settings.svg";
import GithubIcon from "../icons/github.svg";
import ChatGptIcon from "../icons/chatgpt.svg";
import AddIcon from "../icons/add.svg";
import DeleteIcon from "../icons/delete.svg";
import MaskIcon from "../icons/mask.svg";
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
  REPO_URL,
} from "../constant";

import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isIOS, useMobileScreen } from "../utils";
import dynamic from "next/dynamic";
import { showConfirm } from "./ui-lib";
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
        {props.count}
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

  return (
    <div className={styles["resource-panel"]}>
      <ResourcePanelItem
        title="全部图片"
        count={resources.length}
        selected={!sessionId && activeTime === "all"}
        onClick={() => goTo("")}
        narrow={props.narrow}
      />
      <ResourcePanelItem
        title="今天"
        count={todayCount}
        selected={!sessionId && activeTime === "today"}
        onClick={() => goTo("?time=today")}
        narrow={props.narrow}
      />
      <ResourcePanelItem
        title="本周"
        count={weekCount}
        selected={!sessionId && activeTime === "week"}
        onClick={() => goTo("?time=week")}
        narrow={props.narrow}
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
          onClick={() =>
            goTo(`?session=${encodeURIComponent(session.id)}`)
          }
          narrow={props.narrow}
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
  const lastUpdateTime = useRef(Date.now());

  const toggleSideBar = () => {
    config.update((config) => {
      if (config.sidebarWidth < MIN_SIDEBAR_WIDTH) {
        config.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
      } else {
        config.sidebarWidth = NARROW_SIDEBAR_WIDTH;
      }
    });
  };

  const onDragStart = (e: MouseEvent) => {
    // Remembers the initial width each time the mouse is pressed
    startX.current = e.clientX;
    startDragWidth.current = config.sidebarWidth;
    const dragStartTime = Date.now();

    const handleDragMove = (e: MouseEvent) => {
      if (Date.now() < lastUpdateTime.current + 20) {
        return;
      }
      lastUpdateTime.current = Date.now();
      const d = e.clientX - startX.current;
      const nextWidth = limit(startDragWidth.current + d);
      config.update((config) => {
        if (nextWidth < MIN_SIDEBAR_WIDTH) {
          config.sidebarWidth = NARROW_SIDEBAR_WIDTH;
        } else {
          config.sidebarWidth = nextWidth;
        }
      });
    };

    const handleDragEnd = () => {
      // In useRef the data is non-responsive, so `config.sidebarWidth` can't get the dynamic sidebarWidth
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);

      // if user click the drag icon, should toggle the sidebar
      const shouldFireClick = Date.now() - dragStartTime < 300;
      if (shouldFireClick) {
        toggleSideBar();
      }
    };

    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
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
  onDragStart: (e: MouseEvent) => void;
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
  const config = useAppConfig();
  const chatStore = useChatStore();
  const imageChatStore = useImageChatStore();
  const [mcpEnabled, setMcpEnabled] = useState(false);

  useEffect(() => {
    // 检查 MCP 是否启用
    const checkMcpStatus = async () => {
      const enabled = await isMcpEnabled();
      setMcpEnabled(enabled);
      console.log("[SideBar] MCP enabled:", enabled);
    };
    checkMcpStatus();
  }, []);

  return (
    <SideBarContainer
      onDragStart={onDragStart}
      shouldNarrow={shouldNarrow}
      className={props.className}
    >
      <SideBarHeader
        title="NextChat"
        subTitle="Build your own AI assistant."
        logo={<ChatGptIcon />}
        shouldNarrow={shouldNarrow}
      >
        <div className={styles["sidebar-header-bar"]}>
          <IconButton
            icon={<MaskIcon />}
            text={shouldNarrow ? undefined : "资源管理"}
            className={styles["sidebar-bar-button"]}
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
            className={styles["sidebar-bar-button"]}
            onClick={() => {
              navigate(Path.Chat, { state: { fromHome: true } });
            }}
            shadow
          />
          <IconButton
            icon={<ImageIcon />}
            text={shouldNarrow ? undefined : Locale.ImageChat.Name}
            className={styles["sidebar-bar-button"]}
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
            {mode !== "resource" && (
              <div className={clsx(styles["sidebar-action"], styles.mobile)}>
                <IconButton
                  icon={<DeleteIcon />}
                  onClick={async () => {
                    if (await showConfirm(Locale.Home.DeleteChat)) {
                      if (mode === "image") {
                        imageChatStore.deleteSession(
                          imageChatStore.currentSessionIndex,
                        );
                      } else {
                        chatStore.deleteSession(chatStore.currentSessionIndex);
                      }
                    }
                  }}
                />
              </div>
            )}
            <div className={styles["sidebar-action"]}>
              <Link to={Path.Settings}>
                <IconButton
                  aria={Locale.Settings.Title}
                  icon={<SettingsIcon />}
                  shadow
                />
              </Link>
            </div>
            <div className={styles["sidebar-action"]}>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                <IconButton
                  aria={Locale.Export.MessageFromChatGPT}
                  icon={<GithubIcon />}
                  shadow
                />
              </a>
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
                  navigate(Path.Sd);
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
