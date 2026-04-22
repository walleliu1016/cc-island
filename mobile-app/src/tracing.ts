// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { trace, isSpanContextValid } from '@opentelemetry/api'

// Environment variables (Vite supports import.meta.env)
const TRACING_ENABLED = import.meta.env.VITE_TRACING_ENABLED === 'true'
const OTEL_ENDPOINT = import.meta.env.VITE_OTEL_ENDPOINT || ''

let tracerProvider: WebTracerProvider | null = null
let tracer: ReturnType<typeof trace.getTracer> | null = null

/**
 * Initialize OpenTelemetry tracing
 * Returns tracer instance if enabled, null otherwise
 */
export function initTracing(): ReturnType<typeof trace.getTracer> | null {
  if (!TRACING_ENABLED || !OTEL_ENDPOINT) {
    console.log('[Tracing] Disabled or no endpoint configured')
    return null
  }

  console.log('[Tracing] Initializing with endpoint:', OTEL_ENDPOINT)

  // Create resource with service name
  const resource = new Resource({
    'service.name': 'cc-island-mobile',
  })

  // Create provider
  tracerProvider = new WebTracerProvider({
    resource,
  })

  // Create OTLP exporter (HTTP)
  const exporter = new OTLPTraceExporter({
    url: `${OTEL_ENDPOINT}/v1/traces`,
  })

  // Add span processor (batch for efficiency)
  tracerProvider.addSpanProcessor(new BatchSpanProcessor(exporter))

  // Register provider
  tracerProvider.register()

  // Get tracer
  tracer = trace.getTracer('cc-island-mobile')

  console.log('[Tracing] Initialized successfully')
  return tracer
}

/**
 * Get the tracer instance
 */
export function getTracer(): ReturnType<typeof trace.getTracer> | null {
  return tracer
}

/**
 * Check if tracing is enabled
 */
export function isTracingEnabled(): boolean {
  return TRACING_ENABLED && !!tracer
}

/**
 * Inject trace context into outgoing message
 * Returns traceparent string in W3C format
 */
export function injectTraceContext(): { traceparent: string } | null {
  if (!tracer) return null

  const activeSpan = trace.getActiveSpan()
  if (!activeSpan) return null

  const spanContext = activeSpan.spanContext()
  if (!isSpanContextValid(spanContext)) return null

  const traceId = spanContext.traceId
  const spanId = spanContext.spanId
  const traceFlags = spanContext.traceFlags

  return {
    traceparent: `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`
  }
}

/**
 * Extract trace context from incoming message
 * Returns null if no valid context found
 */
export function extractTraceContext(msg: { trace_context?: { traceparent?: string } }): {
  traceId: string
  spanId: string
} | null {
  if (!msg.trace_context?.traceparent) return null

  const parts = msg.trace_context.traceparent.split('-')
  if (parts.length !== 4 || parts[0] !== '00') return null

  return {
    traceId: parts[1],
    spanId: parts[2],
  }
}

// Initialize on module load
tracer = initTracing()