import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Movie RAG",
  description: "Ask grounded questions over the movie catalog and your own documents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <SiteHeader />
          <main className="page">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
