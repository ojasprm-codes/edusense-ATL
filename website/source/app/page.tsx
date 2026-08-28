import type { Metadata } from "next";
import { HomeClient } from "./HomeClient";

export const metadata: Metadata = {
  title: "EDUSENSE AI | Smart Classroom Monitoring Service Portal",
  description:
    "EDUSENSE AI Schools helps schools monitor classroom air quality, understand environmental changes, review historical trends, and respond with confidence.",
};

export default function Home() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://edusense-ai-schools.ojas-premt2.chatgpt.site/#organization",
        name: "EDUSENSE AI",
        url: "https://edusense-ai-schools.ojas-premt2.chatgpt.site/",
        description: "Smart classroom environmental monitoring and air-quality intelligence for schools.",
      },
      {
        "@type": "WebSite",
        "@id": "https://edusense-ai-schools.ojas-premt2.chatgpt.site/#website",
        url: "https://edusense-ai-schools.ojas-premt2.chatgpt.site/",
        name: "EDUSENSE AI",
        publisher: { "@id": "https://edusense-ai-schools.ojas-premt2.chatgpt.site/#organization" },
      },
      {
        "@type": "Service",
        name: "Smart Classroom Monitoring Service Portal",
        serviceType: "Classroom environmental monitoring and air-quality intelligence",
        provider: { "@id": "https://edusense-ai-schools.ojas-premt2.chatgpt.site/#organization" },
        url: "https://edusense-ai-schools.ojas-premt2.chatgpt.site/#about",
        description: "Live classroom environmental insights, intelligent air-quality status, historical trends, and remote school device access.",
        audience: { "@type": "EducationalAudience", educationalRole: "school" },
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <HomeClient />
    </>
  );
}
