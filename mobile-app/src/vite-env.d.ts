/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRACING_ENABLED: string
  readonly VITE_OTEL_ENDPOINT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}