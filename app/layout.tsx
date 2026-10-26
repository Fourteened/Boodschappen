import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { ServiceWorker } from "./service-worker";
import "./globals.css";

const sans = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Boodschappen",
  description: "De gedeelde boodschappenlijst en het weekmenu voor iedereen in huis.",
  applicationName: "Boodschappen",
  appleWebApp: {
    capable: true,
    title: "Boodschappen",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F6F0" },
    { media: "(prefers-color-scheme: dark)", color: "#19141F" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={sans.variable}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
