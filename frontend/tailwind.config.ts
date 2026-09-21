import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1360px" } },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        destructive: { DEFAULT: "hsl(var(--critical))", foreground: "hsl(var(--primary-foreground))" },
        // Signal colours. Amber is the brand accent; warning is a distinct orange so the two never collide.
        critical: { DEFAULT: "hsl(var(--critical))", soft: "hsl(var(--critical-soft))" },
        warning: { DEFAULT: "hsl(var(--warning))", soft: "hsl(var(--warning-soft))" },
        low: { DEFAULT: "hsl(var(--low))", soft: "hsl(var(--low-soft))" },
        success: { DEFAULT: "hsl(var(--success))", soft: "hsl(var(--success-soft))" },
        over: { DEFAULT: "hsl(var(--over))", soft: "hsl(var(--over-soft))" },
        navy: { DEFAULT: "hsl(var(--primary))", 700: "hsl(219 50% 26%)", 500: "hsl(219 40% 38%)" },
        amber: { DEFAULT: "hsl(var(--accent))", ink: "hsl(36 100% 28%)" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        panel: "1rem",
      },
      boxShadow: {
        panel: "0 1px 0 hsl(var(--border)), 0 8px 24px -16px hsl(219 61% 18% / 0.28)",
        lift: "0 1px 0 hsl(var(--border)), 0 12px 28px -14px hsl(219 61% 18% / 0.34)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [animate],
};

export default config;
