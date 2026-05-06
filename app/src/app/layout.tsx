import type { Metadata } from "next";
import { Manrope, Chakra_Petch } from "next/font/google";
import "./globals.css";
import { WalletProviders } from "@/components/WalletProviders";
import { Header } from "@/components/Header";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

const chakraPetch = Chakra_Petch({
  variable: "--font-chakra-petch",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Tandem Wallet",
  description: "Balanced autonomy. Let agents move fast, require humans when necessary.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${chakraPetch.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <WalletProviders>
          <Header />
          <main className="relative z-10 flex-1 mx-auto w-full max-w-5xl px-6 py-10">
            {children}
          </main>
        </WalletProviders>
      </body>
    </html>
  );
}
