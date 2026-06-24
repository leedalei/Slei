import type { Icon, IconProps } from "@tabler/icons-react";
import {
  IconAlertCircleFilled,
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
  IconMessageCircleFilled,
  IconPencil,
  IconSearch,
  IconSend,
  IconSettingsFilled,
  IconSquareCheckFilled,
  IconTrash,
  IconUsersGroup,
  IconUserCircle,
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
  | "hash"
  | "members"
  | "pencil"
  | "search"
  | "send"
  | "settings"
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
  hash: IconHash,
  members: IconUsersGroup,
  pencil: IconPencil,
  search: IconSearch,
  send: IconSend,
  settings: IconSettingsFilled,
  status: IconCircleFilled,
  tasks: IconSquareCheckFilled,
  user: IconUserCircle,
  computer: IconDeviceDesktopFilled,
  x: IconX,
};
