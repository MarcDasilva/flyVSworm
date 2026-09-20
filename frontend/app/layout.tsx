import type { Metadata } from "next";
import ChainCounter from "@/components/chain/ChainCounter";
import "./globals.css";

// No next/font/google: the demo runs offline, so fonts come from the system stacks in globals.css.

export const metadata: Metadata = {
  title: "Fly brain",
  description: "A fruit fly at its computer; click it to watch its brain live.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        {/* the brain's transaction count on Thru: an overlay on every page, and it hides itself
            when the backend is not writing, so neither scene has to know about it */}
        <ChainCounter />
      </body>
    </html>
  );
}
