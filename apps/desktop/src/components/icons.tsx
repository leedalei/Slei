import type { Icon, IconProps } from "@tabler/icons-react";
import {
  IconAlertCircleFilled,
  IconArrowsSort,
  IconBellFilled,
  IconBookmarkFilled,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconCircleFilled,
  IconCopy,
  IconDeviceDesktopFilled,
  IconFolderPlus,
  IconHash,
  IconInfoCircle,
  IconLoader2,
  IconMessageCircleFilled,
  IconPencil,
  IconPalette,
  IconPlus,
  IconSearch,
  IconSend,
  IconServer,
  IconSettingsFilled,
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
  | "check"
  | "chat"
  | "chevronDown"
  | "chevronRight"
  | "chevronUp"
  | "copy"
  | "delete"
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
  check: IconCheck,
  chat: IconMessageCircleFilled,
  chevronDown: IconChevronDown,
  chevronRight: IconChevronRight,
  chevronUp: IconChevronUp,
  copy: IconCopy,
  delete: IconTrash,
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
  sort: IconArrowsSort,
  status: IconCircleFilled,
  tasks: IconSquareCheckFilled,
  user: IconUserCircle,
  computer: IconDeviceDesktopFilled,
  x: IconX,
};
