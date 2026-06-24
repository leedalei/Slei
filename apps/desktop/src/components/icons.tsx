import type { Icon, IconProps } from "@tabler/icons-react";
import {
  IconAlertCircleFilled,
  IconArrowDown,
  IconArrowsSort,
  IconBookmark,
  IconBellFilled,
  IconBookmarkFilled,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconCircleFilled,
  IconCopy,
  IconCpu,
  IconDeviceDesktopFilled,
  IconExternalLink,
  IconFile,
  IconFileText,
  IconFolderOpen,
  IconFolderPlus,
  IconHash,
  IconInfoCircle,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconLoader2,
  IconMessage,
  IconMessageCircleFilled,
  IconPencil,
  IconPalette,
  IconPaperclip,
  IconPhoto,
  IconPlus,
  IconRobot,
  IconSearch,
  IconSend,
  IconServer,
  IconSettingsFilled,
  IconShieldCheck,
  IconSparkles,
  IconSquareCheckFilled,
  IconTrash,
  IconUsersGroup,
  IconUserCircle,
  IconWorld,
  IconX,
} from "@tabler/icons-react";

export type SleiIconName =
  | "approval"
  | "arrowDown"
  | "attachment"
  | "bell"
  | "bookmark"
  | "bookmarkOutline"
  | "bot"
  | "calendar"
  | "check"
  | "chat"
  | "chevronDown"
  | "chevronRight"
  | "chevronUp"
  | "copy"
  | "cpu"
  | "delete"
  | "externalLink"
  | "file"
  | "fileText"
  | "folderOpen"
  | "folderPlus"
  | "globe"
  | "hash"
  | "info"
  | "loader"
  | "members"
  | "messageSquare"
  | "image"
  | "panelClose"
  | "panelOpen"
  | "pencil"
  | "palette"
  | "plus"
  | "search"
  | "send"
  | "server"
  | "settings"
  | "shield"
  | "sparkles"
  | "sort"
  | "status"
  | "tasks"
  | "user"
  | "computer"
  | "x";

export type SleiTablerIcon = Icon;
export type SleiTablerIconProps = IconProps;

export const sleiIcons: Record<SleiIconName, SleiTablerIcon> = {
  approval: IconAlertCircleFilled,
  arrowDown: IconArrowDown,
  attachment: IconPaperclip,
  bell: IconBellFilled,
  bookmark: IconBookmarkFilled,
  bookmarkOutline: IconBookmark,
  bot: IconRobot,
  calendar: IconCalendar,
  check: IconCheck,
  chat: IconMessageCircleFilled,
  chevronDown: IconChevronDown,
  chevronRight: IconChevronRight,
  chevronUp: IconChevronUp,
  copy: IconCopy,
  cpu: IconCpu,
  delete: IconTrash,
  externalLink: IconExternalLink,
  file: IconFile,
  fileText: IconFileText,
  folderOpen: IconFolderOpen,
  folderPlus: IconFolderPlus,
  globe: IconWorld,
  hash: IconHash,
  info: IconInfoCircle,
  loader: IconLoader2,
  members: IconUsersGroup,
  messageSquare: IconMessage,
  image: IconPhoto,
  panelClose: IconLayoutSidebarRightCollapse,
  panelOpen: IconLayoutSidebarRightExpand,
  pencil: IconPencil,
  palette: IconPalette,
  plus: IconPlus,
  search: IconSearch,
  send: IconSend,
  server: IconServer,
  settings: IconSettingsFilled,
  shield: IconShieldCheck,
  sparkles: IconSparkles,
  sort: IconArrowsSort,
  status: IconCircleFilled,
  tasks: IconSquareCheckFilled,
  user: IconUserCircle,
  computer: IconDeviceDesktopFilled,
  x: IconX,
};
