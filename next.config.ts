import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Evita problemas de bundling dessas libs em ambientes serverless (Netlify)
  serverExternalPackages: ['@anthropic-ai/sdk', 'pdf-lib'],

  // Headers de segurança HTTP
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.js requer unsafe-eval em dev
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              `connect-src 'self' https://*.supabase.co wss://*.supabase.co`,
              "font-src 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },

  // Limite de upload — 50MB para importação em lote de XMLs
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
}

export default nextConfig
