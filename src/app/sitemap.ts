import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Required by `output: "export"` — see `robots.ts`.
export const dynamic = "force-static";

// build time: every deploy ships a new build
const lastModified = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/style"].map((path) => ({
    url: new URL(path, SITE_URL).href,
    lastModified,
  }));
}
