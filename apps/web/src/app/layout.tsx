import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

export const runtime = "edge";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: true,
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Sistema de Controle — Bens Sensíveis",
  description: "Plataforma de Governança de Bens Sensíveis",
  manifest: "/manifest.webmanifest",
  // iOS ignora manifest.webmanifest para vários comportamentos nativos do
  // modo standalone (usa suas próprias meta tags proprietárias em vez do
  // padrão web) — sem isso, o WebKit pode tratar o ícone como um bookmark
  // comum (barra do Safari visível) em vez de app standalone de verdade,
  // achado durante a investigação do incidente de PWA 2026-07-17.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "APMCB",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={inter.variable} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
