import type { Icon, IconProps } from "@tabler/icons-react";
import {
  IconAlertCircleFilled,
  IconArrowsSort,
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
  IconFileText,
  IconFolderOpen,
  IconFolderPlus,
  IconHash,
  IconInfoCircle,
  IconLoader2,
  IconMessageCircleFilled,
  IconPencil,
  IconPalette,
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
  | "bell"
  | "bookmark"
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
  | "folderOpen"
  | "folderPlus"
  | "globe"
  | "hash"
  | "info"
  | "loader"
  | "members"
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
  bell: IconBellFilled,
  bookmark: IconBookmarkFilled,
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
  file: IconFileText,
  folderOpen: IconFolderOpen,
  folderPlus: IconFolderPlus,
  globe: IconWorld,
  hash: IconHash,
  info: IconInfoCircle,
  loader: IconLoader2,
  members: IconUsersGroup,
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
