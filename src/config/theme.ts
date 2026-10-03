/**
 * TEMP Arnifi brand tokens — blue primary (not CrossVal green).
 * Replace hex values when official palette is confirmed.
 * Green is reserved for success / posted status only.
 */
export const ARNIFI_THEME = {
  primary: "#1F5BD8",
  primaryHover: "#1747B0",
  primarySubtle: "#E8F0FC",
  accent: "#0E7C66",
  pageBg: "#F7F8FA",
  border: "#E5E7EB",
  text: "#111827",
  muted: "#6B7280",
  surface: "#FFFFFF",
  status: {
    posted: "#0F9D58",
    pending: "#D97706",
    rejected: "#DC2626",
    auto: "#1F5BD8",
    closing: "#7C3AED",
  },
} as const;
