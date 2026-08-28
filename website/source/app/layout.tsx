import type { Metadata } from "next";
import { Poppins, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const previewImage = `${origin}/og.png`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "EDUSENSE AI | Smart Classroom Monitoring Service Portal",
      template: "%s | EDUSENSE AI",
    },
    description:
      "EDUSENSE AI Schools is a smart classroom monitoring service portal for air-quality intelligence, live environmental insights, historical trends, and safer learning spaces.",
    keywords: [
      "classroom air quality",
      "school environmental monitoring",
      "indoor air quality",
      "education technology",
      "EDUSENSE AI",
      "EDUSENSE AI Schools",
      "smart classroom monitoring service portal",
    ],
    applicationName: "EDUSENSE AI",
    authors: [{ name: "EDUSENSE AI" }],
    creator: "EDUSENSE AI",
    publisher: "EDUSENSE AI",
    alternates: { canonical: "/" },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    icons: {
      icon: "/edusense-logo.svg",
      shortcut: "/edusense-logo.svg",
    },
    openGraph: {
      title: "EDUSENSE AI | Smart Classroom Monitoring Service Portal",
      description: "Monitor classroom air quality, environmental trends, and school devices through EDUSENSE AI Schools.",
      type: "website",
      siteName: "EDUSENSE AI",
      url: "/",
      images: [{ url: previewImage, width: 2048, height: 1024, alt: "EDUSENSE AI environmental intelligence dashboard in a classroom" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "EDUSENSE AI | Smart Classroom Monitoring Service Portal",
      description: "Monitor classroom air quality, environmental trends, and school devices through EDUSENSE AI Schools.",
      images: [previewImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${poppins.variable} ${spaceGrotesk.variable}`}>{children}</body>
    </html>
  );
}
