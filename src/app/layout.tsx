import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { getSettings } from "@/lib/settings";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Telegram AI Gateway",
    template: "%s · Telegram AI Gateway",
  },
  description:
    "Personal operations console for a Telegram-to-AI gateway: message history, provider health, fallback traces and logs.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The stored theme preference is read once here so the first paint already
  // matches what the user chose in Settings → Appearance.
  let defaultTheme: "system" | "light" | "dark" = "system";
  try {
    defaultTheme = (await getSettings()).defaultTheme;
  } catch {
    // Database not migrated yet: fall through to the light default.
  }

  return (
    <html
      lang="en"
      className={`${archivo.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider defaultTheme={defaultTheme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
