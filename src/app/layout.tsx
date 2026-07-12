import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ember of Dawn — an ASCII roguelike",
  description:
    "A single-player ASCII roguelike RPG. Escape the pit, cross the cursed land, recover the Sunblade, and end the Lich-King.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-ink text-fg font-mono antialiased select-none">
        {children}
      </body>
    </html>
  );
}
