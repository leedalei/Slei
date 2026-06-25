"use client"

import * as React from "react"
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from "lucide-react"

import { cn } from "@/lib/utils"

type NotificationType = "success" | "error" | "warning" | "info"
type NotificationPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center"

type Notification = {
  id: string
  type: NotificationType
  title: string
  description?: string
  action?: React.ReactNode
  duration?: number
}

type NotificationContextType = {
  notifications: Notification[]
  addNotification: (notification: Omit<Notification, "id">) => void
  removeNotification: (id: string) => void
}

const NotificationContext = React.createContext<NotificationContextType | null>(null)

function useNotification() {
  const context = React.useContext(NotificationContext)
  if (!context) {
    throw new Error("useNotification must be used within a GlassNotificationProvider")
  }
  return context
}

function GlassNotificationProvider({
  children,
  position = "bottom-right",
}: {
  children: React.ReactNode
  position?: NotificationPosition
}) {
  const [notifications, setNotifications] = React.useState<Notification[]>([])

  const addNotification = React.useCallback((notification: Omit<Notification, "id">) => {
    const id = Math.random().toString(36).substring(2, 9)
    setNotifications((prev) => [...prev, { ...notification, id }])

    if (notification.duration !== 0) {
      setTimeout(() => {
        setNotifications((prev) => prev.filter((item) => item.id !== id))
      }, notification.duration ?? 5000)
    }
  }, [])

  const removeNotification = React.useCallback((id: string) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id))
  }, [])

  return (
    <NotificationContext.Provider value={{ notifications, addNotification, removeNotification }}>
      {children}
      <GlassNotificationContainer position={position} />
    </NotificationContext.Provider>
  )
}

const typeConfig = {
  success: {
    icon: CheckCircle,
    gradient: "from-emerald-500/30 to-green-500/30",
    border: "border-emerald-400/30",
    iconColor: "text-emerald-400",
  },
  error: {
    icon: AlertCircle,
    gradient: "from-red-500/30 to-rose-500/30",
    border: "border-red-400/30",
    iconColor: "text-red-400",
  },
  warning: {
    icon: AlertTriangle,
    gradient: "from-amber-500/30 to-yellow-500/30",
    border: "border-amber-400/30",
    iconColor: "text-amber-400",
  },
  info: {
    icon: Info,
    gradient: "from-cyan-500/30 to-blue-500/30",
    border: "border-cyan-400/30",
    iconColor: "text-cyan-400",
  },
}

const positionStyles: Record<NotificationPosition, { container: string; animation: string }> = {
  "top-right": {
    container: "top-4 right-4",
    animation: "slide-in-from-right-full",
  },
  "top-left": {
    container: "top-4 left-4",
    animation: "slide-in-from-left-full",
  },
  "bottom-right": {
    container: "bottom-4 right-4",
    animation: "slide-in-from-right-full",
  },
  "bottom-left": {
    container: "bottom-4 left-4",
    animation: "slide-in-from-left-full",
  },
  "top-center": {
    container: "top-4 left-1/2 -translate-x-1/2",
    animation: "slide-in-from-top-full",
  },
  "bottom-center": {
    container: "bottom-4 left-1/2 -translate-x-1/2",
    animation: "slide-in-from-bottom-full",
  },
}

function GlassNotificationContainer({ position = "bottom-right" }: { position?: NotificationPosition }) {
  const { notifications, removeNotification } = useNotification()
  const positionConfig = positionStyles[position]

  return (
    <div
      className={cn("pointer-events-none fixed z-50 flex w-full max-w-sm flex-col gap-3", positionConfig.container)}
      role="region"
      aria-label="Notifications"
    >
      {notifications.map((notification, index) => (
        <GlassNotificationItem
          animationClass={positionConfig.animation}
          key={notification.id}
          notification={notification}
          onClose={() => removeNotification(notification.id)}
          style={{
            transform: `scale(${1 - index * 0.02})`,
            opacity: 1 - index * 0.1,
          }}
        />
      ))}
    </div>
  )
}

type GlassNotificationItemProps = {
  notification: Notification
  onClose?: () => void
  style?: React.CSSProperties
  animationClass?: string
  ariaLive?: "assertive" | "polite" | "off"
  className?: string
  closeLabel?: string
  role?: "alert" | "status"
  toast?: boolean
}

function GlassNotificationItem({
  notification,
  onClose,
  style,
  animationClass = "slide-in-from-right-full",
  ariaLive,
  className,
  closeLabel = "Dismiss notification",
  role = "alert",
  toast = false,
}: GlassNotificationItemProps) {
  const config = typeConfig[notification.type]
  const Icon = config.icon
  const [progress, setProgress] = React.useState(100)
  const duration = notification.duration ?? 5000

  React.useEffect(() => {
    if (duration === 0) return undefined

    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev - 100 / (duration / 100)
        return newProgress <= 0 ? 0 : newProgress
      })
    }, 100)

    return () => clearInterval(interval)
  }, [duration])

  return (
    <div
      aria-live={ariaLive}
      className={cn("pointer-events-auto animate-in fade-in duration-300", animationClass, className)}
      data-slot="notification"
      data-toast-notification={toast ? "true" : undefined}
      data-type={notification.type}
      role={role}
      style={style}
    >
      <div className="relative">
        <div className={cn("absolute -inset-1.5 rounded-xl bg-linear-to-r opacity-60 blur-xl", config.gradient)} />
        <div
          data-slot="notification-surface"
          className={cn(
            "relative overflow-hidden rounded-xl border backdrop-blur-2xl",
            toast ? "bg-white/70 backdrop-saturate-150" : "bg-white/10",
            "shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.15)]",
            config.border,
          )}
        >
          <div className="pointer-events-none absolute inset-0 rounded-xl bg-linear-to-b from-white/15 to-transparent" />
          <div className="pointer-events-none absolute inset-0 rounded-xl bg-linear-to-tr from-transparent to-white/10" />

          <div
            className={cn("relative flex gap-3", toast ? "items-center px-3.5 py-2.5" : "items-start p-4")}
            data-slot="notification-content"
          >
            <div
              data-slot="notification-icon-container"
              className={cn(
                "flex shrink-0 items-center justify-center rounded-lg border border-white/10",
                toast ? "h-7 w-7" : "h-8 w-8",
                `bg-linear-to-br ${config.gradient}`,
              )}
            >
              <Icon className={cn(toast ? "h-4 w-4" : "h-5 w-5", config.iconColor)} aria-hidden="true" data-slot="notification-icon" />
            </div>

            <div className="min-w-0 flex-1">
              <h4 className="font-medium text-foreground whitespace-normal break-words" data-slot="notification-title">{notification.title}</h4>
              {notification.description ? <p className="mt-1 text-sm text-muted-foreground" data-slot="notification-description">{notification.description}</p> : null}
              {notification.action ? <div className="mt-2" data-slot="notification-action-container">{notification.action}</div> : null}
            </div>

            {onClose ? (
              <button
                onClick={onClose}
                aria-label={closeLabel}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                data-slot="notification-close"
                type="button"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {duration !== 0 ? (
            <div className="h-1 bg-white/5">
              <div
                className={cn("h-full bg-linear-to-r transition-all duration-100 ease-linear", config.gradient)}
                style={{ width: `${progress}%` }}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function GlassNotification({
  type = "info",
  title,
  description,
  className,
}: {
  type?: NotificationType
  title: string
  description?: string
  className?: string
}) {
  const config = typeConfig[type]
  const Icon = config.icon

  return (
    <div className={cn("relative", className)} data-slot="notification" data-type={type}>
      <div className={cn("absolute -inset-1.5 rounded-xl bg-linear-to-r opacity-60 blur-xl", config.gradient)} />
      <div
        className={cn(
          "relative rounded-xl border bg-white/10 backdrop-blur-2xl",
          "shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.15)]",
          config.border,
        )}
      >
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-linear-to-b from-white/15 to-transparent" />
        <div className="relative flex items-start gap-3 p-4">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10",
              `bg-linear-to-br ${config.gradient}`,
            )}
          >
            <Icon className={cn("h-5 w-5", config.iconColor)} />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="font-medium text-foreground whitespace-normal break-words" data-slot="notification-title">{title}</h4>
            {description ? <p className="mt-1 text-sm text-muted-foreground" data-slot="notification-description">{description}</p> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

const NotificationProvider = GlassNotificationProvider
const NotificationItem = GlassNotificationItem
const Notification = GlassNotification

export {
  GlassNotification,
  GlassNotificationItem,
  GlassNotificationProvider,
  Notification,
  NotificationItem,
  NotificationProvider,
  useNotification,
}
export type { NotificationPosition, NotificationType }
