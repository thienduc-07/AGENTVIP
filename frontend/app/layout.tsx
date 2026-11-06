import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Agent City — Grand Line Command Center",
  description:
    "Realtime 3D Autonomous AI Agent Command Center inspired by anime pirate islands, with real tool calling, security sandbox, and Captain's approval workflow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning className="h-full bg-[#070b14] text-slate-100 antialiased">
      <body
        suppressHydrationWarning
        className="w-full h-full m-0 p-0 overflow-hidden select-none bg-[#070b14]"
      >
        {children}
      </body>
    </html>
  );
}
