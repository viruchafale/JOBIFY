import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/navbar";
import { ThemeProvider } from "@/components/theme-provider";
import { AppProvider } from "@/context/AppContext";

export const metadata: Metadata = {
  title: "Hire Heaven - Modern Job Portal",
  description: "Find your dream job or the perfect candidate with our AI-powered portal.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="relative min-h-screen bg-background font-sans antialiased">
        <div className="fixed inset-0 -z-20 bg-[radial-gradient(circle_at_top,_rgba(19,78,74,0.16),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(245,158,11,0.14),_transparent_30%),linear-gradient(180deg,_var(--background),_color-mix(in_oklab,var(--background)_92%,white))]" />
        <div className="fixed inset-0 -z-10 bg-[linear-gradient(to_right,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.04)_1px,transparent_1px)] bg-[size:80px_80px] [mask-image:radial-gradient(circle_at_center,black,transparent_80%)] pointer-events-none" />

        <AppProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <Navbar />
            <main className="relative z-10">{children}</main>
          </ThemeProvider>
        </AppProvider>
      </body>
    </html>
  );
}
