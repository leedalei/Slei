import { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Bell,
  Bookmark,
  Bot,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleUserRound,
  Copy,
  Cpu,
  ExternalLink,
  File,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe,
  Hash,
  Image,
  Info,
  Kanban,
  ListFilter,
  LoaderCircle,
  MessageCircle,
  MessageSquare,
  Monitor,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SearchCheck,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
  Trash,
  Users,
  UsersRound,
  X,
} from "lucide-react";

export type SleiIconName =
  | "approval"
  | "arrowDown"
  | "arrowUp"
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
  | "kanban"
  | "listDetails"
  | "loader"
  | "members"
  | "membersFilled"
  | "messageSquare"
  | "image"
  | "panelClose"
  | "panelOpen"
  | "pencil"
  | "palette"
  | "plus"
  | "refreshCw"
  | "search"
  | "searchFilled"
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

export type SleiLucideIcon = LucideIcon;
export type SleiLucideIconProps = LucideProps;

const BookmarkFilled = forwardRef<SVGSVGElement, LucideProps>(({ fill = "currentColor", ...props }, ref) => (
  <Bookmark ref={ref} fill={fill} {...props} />
)) as LucideIcon;
BookmarkFilled.displayName = "BookmarkFilled";

export const sleiIcons: Record<SleiIconName, SleiLucideIcon> = {
  approval: CircleAlert,
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  attachment: Paperclip,
  bell: Bell,
  bookmark: BookmarkFilled,
  bookmarkOutline: Bookmark,
  bot: Bot,
  calendar: Calendar,
  check: Check,
  chat: MessageCircle,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  copy: Copy,
  cpu: Cpu,
  delete: Trash,
  externalLink: ExternalLink,
  file: File,
  fileText: FileText,
  folderOpen: FolderOpen,
  folderPlus: FolderPlus,
  globe: Globe,
  hash: Hash,
  info: Info,
  kanban: Kanban,
  listDetails: ListFilter,
  loader: LoaderCircle,
  members: Users,
  membersFilled: UsersRound,
  messageSquare: MessageSquare,
  image: Image,
  panelClose: PanelRightClose,
  panelOpen: PanelRightOpen,
  pencil: Pencil,
  palette: Palette,
  plus: Plus,
  refreshCw: RefreshCw,
  search: Search,
  searchFilled: SearchCheck,
  send: Send,
  server: Server,
  settings: Settings,
  shield: ShieldCheck,
  sparkles: Sparkles,
  sort: ArrowDownUp,
  status: Circle,
  tasks: SquareCheckBig,
  user: CircleUserRound,
  computer: Monitor,
  x: X,
};
