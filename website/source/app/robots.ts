import type { MetadataRoute } from "next";

const siteUrl = "https://edusense-ai-schools.ojas-premt2.chatgpt.site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
