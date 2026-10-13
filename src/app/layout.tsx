import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

import { LAB_NAME } from "@/lib/lab";

import "./globals.css";

/*
 * The two Beyondles fonts. next/font downloads them at build time and serves
 * them from this Lab (no request to Google at runtime). The variables are read
 * by src/app/globals.css (Tailwind) and by the frame (`--by-app-font`).
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: LAB_NAME,
  description: `${LAB_NAME}, a Beyondles Lab.`,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${inter.variable} ${poppins.variable} antialiased`}>
      <body className="min-h-full bg-canvas font-sans text-body">
        {/* Without props the provider takes locale, messages and time zone
            from src/i18n/request.ts, so `useTranslations` works in every
            client component. */}
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
