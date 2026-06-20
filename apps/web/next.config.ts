import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Turbopack configuration to fix workspace root inference in monorepos
  turbopack: {
    // Resolve absolute path to monorepo root
    root: path.resolve(process.cwd(), "../../"),
  },
  env: {
    NEXT_PUBLIC_LANGUAGE: process.env.NEXT_PUBLIC_LANGUAGE || 'pt',
    NEXT_PUBLIC_BRAND_SIGLA: process.env.NEXT_PUBLIC_BRAND_SIGLA || 'AQ',
    NEXT_PUBLIC_BRAND_NAME_PREFIX: process.env.NEXT_PUBLIC_BRAND_NAME_PREFIX || 'Arena',
    NEXT_PUBLIC_BRAND_NAME_ACCENT: process.env.NEXT_PUBLIC_BRAND_NAME_ACCENT || 'Quest',
    NEXT_PUBLIC_BRAND_POWERED_BY: process.env.NEXT_PUBLIC_BRAND_POWERED_BY || '',
    NEXT_PUBLIC_BRAND_ACCENT: process.env.NEXT_PUBLIC_BRAND_ACCENT || '',
  },
};

export default nextConfig;
