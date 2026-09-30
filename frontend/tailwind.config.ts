import type { Config } from "tailwindcss";

const config: Config = {
  // `relative: true` => resolve these against THIS config file (frontend/),
  // not the process cwd (repo root) — required now that Next runs as `next dev frontend`.
  content: {
    relative: true,
    files: [
      "./app/**/*.{js,ts,jsx,tsx,mdx}",
      "./components/**/*.{js,ts,jsx,tsx,mdx}",
      "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    ],
  },
  theme: {
    extend: {
      colors: {
        // Legacy brand aliases. Kept so the existing `brand-*` usages keep
        // working, but remapped onto the Sovereign Green palette so every one
        // of them inherits the redesign without a rename.
        brand: {
          green: "#0D472A", // Royal Green — primary actions & verified state
          greenDark: "#125B35", // Extended Emerald — hover/active
          red: "#721422", // Wine — urgent, destructive, redemption
          amber: "#F59E0B", // offers & scratch cards only
          bg: "#F1FCF4", // porcelain canvas
          card: "#FFFFFF",
          textMain: "#141E19", // botanical charcoal, never pure black
          textMuted: "#414942",
          border: "#E5E9E4", // hairline stroke
        },

        // ── Sovereign Green semantic tokens ────────────────────────────────
        // Named 1:1 with the Stitch export (`bg-surface-container-lowest`,
        // `text-on-surface-variant`, …) so screens port across directly.
        surface: {
          DEFAULT: "#f1fcf4",
          dim: "#d1ddd5",
          bright: "#f1fcf4",
          container: {
            lowest: "#ffffff",
            low: "#ebf6ee",
            DEFAULT: "#e5f1e8",
            high: "#dfebe3",
            highest: "#dae5dd",
          },
        },
        "surface-variant": "#dae5dd",
        "surface-tint": "#336949",
        "on-surface": { DEFAULT: "#141e19", variant: "#414942" },
        "inverse-surface": "#28332d",
        "inverse-on-surface": "#e8f4eb",
        outline: { DEFAULT: "#717971", variant: "#c0c9c0" },

        primary: {
          DEFAULT: "#002f19",
          on: "#ffffff",
          container: "#0d472a",
          "on-container": "#7db590",
          inverse: "#9ad3ac",
        },
        "on-primary": "#ffffff",
        "primary-container": "#0d472a",
        "on-primary-container": "#7db590",
        "inverse-primary": "#9ad3ac",
        "primary-fixed": { DEFAULT: "#b6f0c7", dim: "#9ad3ac" },
        "on-primary-fixed": { DEFAULT: "#002110", variant: "#195032" },

        secondary: {
          DEFAULT: "#a43a43",
          on: "#ffffff",
          container: "#fe7f86",
          "on-container": "#741623",
        },
        "on-secondary": "#ffffff",
        "secondary-container": "#fe7f86",
        "on-secondary-container": "#741623",
        "secondary-fixed": { DEFAULT: "#ffdada", dim: "#ffb3b4" },
        "on-secondary-fixed": { DEFAULT: "#40000b", variant: "#84222e" },

        tertiary: {
          DEFAULT: "#002f17",
          on: "#ffffff",
          container: "#004827",
          "on-container": "#73b889",
        },
        "tertiary-fixed": { DEFAULT: "#abf3c0", dim: "#90d6a5" },
        "on-tertiary-fixed": { DEFAULT: "#00210f", variant: "#02522d" },

        error: {
          DEFAULT: "#ba1a1a",
          on: "#ffffff",
          container: "#ffdad6",
          "on-container": "#93000a",
        },

        // Flat aliases matching the export's class names directly.
        wine: "#721422",
        emerald: "#125B35",
        porcelain: "#F9FAF8",
        hairline: "rgba(24, 34, 29, 0.08)",
      },

      borderRadius: {
        // Redesign geometry: 8px controls, 16px cards, 24px pass panels.
        sm: "0.25rem",
        DEFAULT: "0.5rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.5rem",
        input: "8px",
        card: "16px",
        panel: "24px",
        pill: "9999px",
      },

      spacing: {
        // Token vocabulary used by the Stitch exports (`px-space-md`,
        // `gap-space-sm`, …). Plain Tailwind spacing still works alongside.
        "space-xs": "0.25rem",
        "space-sm": "0.5rem",
        "space-md": "1rem",
        "space-lg": "1.5rem",
        "space-xl": "2.5rem",
        gutter: "1.5rem",
        "gutter-sm": "1rem",
        margin: "2rem",
        "margin-sm": "1rem",
      },

      fontFamily: {
        sans: ["var(--font-inter)", "var(--font-jakarta)", "sans-serif"],
        // Headline family — Plus Jakarta Sans.
        "display-lg": ["var(--font-jakarta)", "sans-serif"],
        "display-lg-mobile": ["var(--font-jakarta)", "sans-serif"],
        "headline-lg": ["var(--font-jakarta)", "sans-serif"],
        "headline-lg-mobile": ["var(--font-jakarta)", "sans-serif"],
        "headline-md": ["var(--font-jakarta)", "sans-serif"],
        "headline-sm": ["var(--font-jakarta)", "sans-serif"],
        "metric-num": ["var(--font-jakarta)", "sans-serif"],
        // Body / label family — Inter.
        "body-lg": ["var(--font-inter)", "sans-serif"],
        "body-md": ["var(--font-inter)", "sans-serif"],
        "body-sm": ["var(--font-inter)", "sans-serif"],
        "label-lg": ["var(--font-inter)", "sans-serif"],
        "label-md": ["var(--font-inter)", "sans-serif"],
        "label-sm": ["var(--font-inter)", "sans-serif"],
      },

      fontSize: {
        "display-lg": ["48px", { lineHeight: "56px", letterSpacing: "-0.03em", fontWeight: "700" }],
        "display-lg-mobile": ["36px", { lineHeight: "44px", letterSpacing: "-0.025em", fontWeight: "700" }],
        "headline-lg": ["32px", { lineHeight: "40px", letterSpacing: "-0.02em", fontWeight: "600" }],
        "headline-lg-mobile": ["26px", { lineHeight: "34px", letterSpacing: "-0.015em", fontWeight: "600" }],
        "headline-md": ["24px", { lineHeight: "32px", letterSpacing: "-0.015em", fontWeight: "600" }],
        "headline-sm": ["18px", { lineHeight: "26px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "metric-num": ["28px", { lineHeight: "32px", letterSpacing: "-0.03em", fontWeight: "700" }],
        "body-lg": ["16px", { lineHeight: "24px", letterSpacing: "-0.005em", fontWeight: "400" }],
        "body-md": ["14px", { lineHeight: "20px", letterSpacing: "0em", fontWeight: "400" }],
        "body-sm": ["12px", { lineHeight: "16px", letterSpacing: "0.005em", fontWeight: "400" }],
        "label-lg": ["14px", { lineHeight: "20px", letterSpacing: "0.01em", fontWeight: "600" }],
        "label-md": ["12px", { lineHeight: "16px", letterSpacing: "0.02em", fontWeight: "500" }],
        "label-sm": ["11px", { lineHeight: "14px", letterSpacing: "0.04em", fontWeight: "600" }],
      },

      boxShadow: {
        // Ambient Green Glow — raised cards / interactive modules.
        ambient:
          "0 8px 30px -4px rgba(13, 71, 42, 0.08), 0 2px 6px -1px rgba(24, 34, 29, 0.04)",
        hairline: "0 1px 2px rgba(24, 34, 29, 0.04)",
        frost: "0 1px 8px rgba(0, 0, 0, 0.04)",
        // Hairline inset used on primary buttons.
        "inset-light": "inset 0 0 0 1px rgba(255, 255, 255, 0.15)",
      },
    },
  },
  plugins: [],
};
export default config;
