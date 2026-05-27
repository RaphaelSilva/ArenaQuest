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
  },
};

export default nextConfig;
