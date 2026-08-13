import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Archive,
  BellMinus,
  BellPlus,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  RefreshCw,
} from "lucide-react";

export const WALL_ACTION_LABELS: Record<string, string> = {
  created: "Created",
  alert_added: "Alert added",
  alert_removed: "Alert removed",
  status_changed: "Status changed",
  closed: "Closed",
  reopened: "Reopened",
  severity_changed: "Severity changed",
  comment: "Comment",
};

export const WALL_ACTION_TONE: Record<string, string> = {
  comment: "comment",
  created: "system",
  alert_added: "alert",
  alert_removed: "muted",
  status_changed: "status",
  closed: "closed",
  reopened: "status",
  severity_changed: "severity",
};

export const WALL_ACTION_ICONS: Record<string, LucideIcon> = {
  created: FolderPlus,
  alert_added: BellPlus,
  alert_removed: BellMinus,
  status_changed: RefreshCw,
  closed: Archive,
  reopened: FolderOpen,
  severity_changed: AlertTriangle,
  comment: MessageSquare,
};
