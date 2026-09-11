/* ─── Domain types shared by server, client and storage adapters ─────────── */

export type ReviewMode = "live" | "frozen" | "upload";

/** Project membership roles, least to most powerful. */
export type Role = "view" | "edit" | "admin";
export const ROLE_RANK: Record<Role, number> = { view: 0, edit: 1, admin: 2 };
export const ROLE_LABEL: Record<Role, string> = { view: "Can view", edit: "Can edit", admin: "Admin" };

/** A signed-in Google account. */
export interface Profile {
  id: string; // auth user id (uuid)
  email: string;
  name: string;
  avatar_url: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string; // short slug used in URLs
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: Role;
  created_at: string;
  /** joined for display */
  profile?: Pick<Profile, "id" | "email" | "name" | "avatar_url" | "color">;
}

export interface ProjectInvite {
  id: string;
  project_id: string;
  email: string;
  role: Role;
  invited_by: string;
  created_at: string;
  accepted_at: string | null;
}

export interface Review {
  id: string; // short slug used in URLs
  project_id: string | null;
  url: string;
  title: string;
  mode: ReviewMode;
  /** storage path of a frozen / uploaded HTML snapshot */
  snapshot_path: string | null;
  default_viewport: number;
  /** display name of the creator (denormalised) */
  created_by: string;
  created_by_id: string | null;
  /** legacy secret from the pre-login era; unused now */
  owner_key: string;
  /** small JPEG preview of the page, captured in the reviewer */
  thumbnail_url: string | null;
  thumbnail_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Everything needed to put a pin back where it was. */
export interface Anchor {
  /** robust CSS path to the element the pin was dropped on */
  selector: string | null;
  /** offset inside that element, as a fraction of its box (0..1) */
  fx: number;
  fy: number;
  /** absolute page coordinates at the time of creation (fallback) */
  px: number;
  py: number;
  /** optional region (drag-to-comment) in page coordinates */
  region?: { x: number; y: number; w: number; h: number } | null;
  /** human readable element path, e.g. "main › section.hero › h1" */
  element_label?: string | null;
  /** the thread applies to every viewport in this band (px, inclusive); absent = only `viewport_width` */
  viewports?: { min: number; max: number } | null;
}

export interface Attachment {
  id: string;
  name: string;
  url: string; // data: URL or storage URL
  w?: number;
  h?: number;
}

export interface Comment {
  id: string;
  review_id: string;
  parent_id: string | null; // null = thread root
  author_id: string | null;
  author_name: string;
  author_color: string;
  /** optional short title for the thread (becomes the Jira summary) */
  title: string | null;
  body: string;
  anchor: Anchor | null; // only on thread roots
  viewport_width: number;
  resolved: boolean;
  reactions: Record<string, string[]>; // emoji -> author names
  attachments: Attachment[];
  edited_at: string | null;
  created_at: string;
}

export type ShapeType =
  | "pen"
  | "highlighter"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "text";

export interface ShapeStyle {
  stroke: string;
  width: number; // px
  opacity: number; // 0..1
  fill?: string | null;
  fontSize?: number;
}

export interface Shape {
  id: string;
  review_id: string;
  viewport_width: number;
  type: ShapeType;
  /** pen/highlighter: points; others: geometry */
  data: {
    points?: number[][]; // [x, y, pressure]
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    x2?: number;
    y2?: number;
    text?: string;
  };
  style: ShapeStyle;
  author_id: string | null;
  author_name: string;
  z: number;
  created_at: string;
  updated_at: string;
}

export interface Viewer {
  user_id: string;
  name: string;
  color: string;
  avatar_url?: string | null;
  key: string; // per-tab session key
  cursor?: { x: number; y: number } | null;
  viewport_width?: number;
}

export const VIEWPORTS: { label: string; width: number; kind: "desktop" | "tablet" | "mobile" }[] = [
  { label: "Desktop · 1920", width: 1920, kind: "desktop" },
  { label: "Desktop · 1440", width: 1440, kind: "desktop" },
  { label: "Tablet · 1024", width: 1024, kind: "tablet" },
  { label: "Tablet · 768", width: 768, kind: "tablet" },
  { label: "Phone · 430", width: 430, kind: "mobile" },
  { label: "Phone · 390", width: 390, kind: "mobile" },
  { label: "Phone · 375", width: 375, kind: "mobile" },
];

export const AUTHOR_COLORS = [
  "#e2342b", "#2c6cf6", "#1f9d55", "#d98b0b", "#8b5cf6",
  "#0e9aa7", "#d63384", "#6b7d2f", "#b05a1a", "#4a5568",
];
