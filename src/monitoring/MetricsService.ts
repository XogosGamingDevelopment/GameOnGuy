/**
 * Game On Dude! - Metrics Service
 * www.gameonguy.com
 *
 * Metrics collection and export for monitoring (Prometheus, CloudWatch compatible).
 */

import logger from '../core/Logger';

// ============================================================================
// Types
// ============================================================================

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricLabels {
  [key: string]: string;
}

export interface MetricValue {
  value: number;
  labels: MetricLabels;
  timestamp: number;
}

export interface Metric {
  name: string;
  help: string;
  type: MetricType;
  values: MetricValue[];
}

export interface HistogramBucket {
  le: number;
  count: number;
}

export interface HistogramValue {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  labels: MetricLabels;
}

export interface Timer {
  end: () => number;
}

// ============================================================================
// Metrics Service
// ============================================================================

export class MetricsService {
  private metrics: Map<string, Metric> = new Map();
  private histograms: Map<string, Map<string, HistogramValue>> = new Map();
  private readonly log = logger.child({ component: 'MetricsService' });
  private readonly prefix: string;
  private readonly defaultBuckets: number[];

  constructor(prefix: string = 'xogos_') {
    this.prefix = prefix;
    this.defaultBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

    // Initialize default metrics
    this.initializeDefaultMetrics();
  }

  private initializeDefaultMetrics(): void {
    // Connection metrics
    this.registerCounter('connections_total', 'Total number of connections');
    this.registerGauge('connections_active', 'Number of active connections');
    this.registerCounter('disconnections_total', 'Total number of disconnections');

    // Room metrics
    this.registerGauge('rooms_active', 'Number of active rooms');
    this.registerCounter('rooms_created_total', 'Total rooms created');
    this.registerCounter('rooms_closed_total', 'Total rooms closed');

    // Message metrics
    this.registerCounter('messages_received_total', 'Total messages received');
    this.registerCounter('messages_sent_total', 'Total messages sent');
    this.registerHistogram('message_processing_duration_seconds', 'Message processing duration');

    // Game metrics
    this.registerCounter('games_started_total', 'Total games started');
    this.registerCounter('games_completed_total', 'Total games completed');
    this.registerHistogram('game_duration_seconds', 'Game duration');

    // Error metrics
    this.registerCounter('errors_total', 'Total errors');

    // System metrics
    this.registerGauge('memory_usage_bytes', 'Memory usage in bytes');
    this.registerGauge('cpu_usage_percent', 'CPU usage percentage');
    this.registerGauge('uptime_seconds', 'Server uptime in seconds');

    // Matchmaking metrics
    this.registerGauge('matchmaking_queue_size', 'Matchmaking queue size');
    this.registerHistogram('matchmaking_wait_seconds', 'Time spent waiting for match');
  }

  // ============================================================================
  // Registration
  // ============================================================================

  registerCounter(name: string, help: string): void {
    this.metrics.set(this.prefix + name, {
      name: this.prefix + name,
      help,
      type: 'counter',
      values: [],
    });
  }

  registerGauge(name: string, help: string): void {
    this.metrics.set(this.prefix + name, {
      name: this.prefix + name,
      help,
      type: 'gauge',
      values: [],
    });
  }

  registerHistogram(name: string, help: string, buckets?: number[]): void {
    this.metrics.set(this.prefix + name, {
      name: this.prefix + name,
      help,
      type: 'histogram',
      values: [],
    });
    this.histograms.set(this.prefix + name, new Map());
  }

  // ============================================================================
  // Counter Operations
  // ============================================================================

  increment(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const fullName = this.prefix + name;
    const metric = this.metrics.get(fullName);
    if (!metric || metric.type !== 'counter') return;

    const labelKey = this.labelsToKey(labels);
    const existing = metric.values.find((v) => this.labelsToKey(v.labels) === labelKey);

    if (existing) {
      existing.value += value;
      existing.timestamp = Date.now();
    } else {
      metric.values.push({
        value,
        labels,
        timestamp: Date.now(),
      });
    }
  }

  // ============================================================================
  // Gauge Operations
  // ============================================================================

  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    const fullName = this.prefix + name;
    const metric = this.metrics.get(fullName);
    if (!metric || metric.type !== 'gauge') return;

    const labelKey = this.labelsToKey(labels);
    const existing = metric.values.find((v) => this.labelsToKey(v.labels) === labelKey);

    if (existing) {
      existing.value = value;
      existing.timestamp = Date.now();
    } else {
      metric.values.push({
        value,
        labels,
        timestamp: Date.now(),
      });
    }
  }

  gaugeIncrement(name: string, labels: MetricLabels = {}, delta: number = 1): void {
    const fullName = this.prefix + name;
    const metric = this.metrics.get(fullName);
    if (!metric || metric.type !== 'gauge') return;

    const labelKey = this.labelsToKey(labels);
    const existing = metric.values.find((v) => this.labelsToKey(v.labels) === labelKey);

    if (existing) {
      existing.value += delta;
      existing.timestamp = Date.now();
    } else {
      metric.values.push({
        value: delta,
        labels,
        timestamp: Date.now(),
      });
    }
  }

  // ============================================================================
  // Histogram Operations
  // ============================================================================

  histogram(name: string, value: number, labels: MetricLabels = {}): void {
    const fullName = this.prefix + name;
    const histogramMap = this.histograms.get(fullName);
    if (!histogramMap) return;

    const labelKey = this.labelsToKey(labels);
    let histogram = histogramMap.get(labelKey);

    if (!histogram) {
      histogram = {
        buckets: this.defaultBuckets.map((le) => ({ le, count: 0 })),
        sum: 0,
        count: 0,
        labels,
      };
      histogramMap.set(labelKey, histogram);
    }

    // Update buckets
    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }

    histogram.sum += value;
    histogram.count++;
  }

  // ============================================================================
  // Timer
  // ============================================================================

  startTimer(name: string, labels: MetricLabels = {}): Timer {
    const start = process.hrtime.bigint();

    return {
      end: () => {
        const end = process.hrtime.bigint();
        const durationSeconds = Number(end - start) / 1e9;
        this.histogram(name, durationSeconds, labels);
        return durationSeconds;
      },
    };
  }

  // ============================================================================
  // Export
  // ============================================================================

  /**
   * Export metrics in Prometheus format.
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];

    for (const metric of this.metrics.values()) {
      // Add HELP and TYPE
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);

      if (metric.type === 'histogram') {
        // Export histogram
        const histogramMap = this.histograms.get(metric.name);
        if (histogramMap) {
          for (const [, hist] of histogramMap) {
            const labelStr = this.labelsToPrometheus(hist.labels);

            // Buckets
            for (const bucket of hist.buckets) {
              const bucketLabels = labelStr
                ? `${labelStr},le="${bucket.le}"`
                : `le="${bucket.le}"`;
              lines.push(`${metric.name}_bucket{${bucketLabels}} ${bucket.count}`);
            }

            // +Inf bucket
            const infLabels = labelStr ? `${labelStr},le="+Inf"` : `le="+Inf"`;
            lines.push(`${metric.name}_bucket{${infLabels}} ${hist.count}`);

            // Sum and count
            const sumLabels = labelStr ? `{${labelStr}}` : '';
            lines.push(`${metric.name}_sum${sumLabels} ${hist.sum}`);
            lines.push(`${metric.name}_count${sumLabels} ${hist.count}`);
          }
        }
      } else {
        // Export counter or gauge
        for (const value of metric.values) {
          const labelStr = this.labelsToPrometheus(value.labels);
          const labelPart = labelStr ? `{${labelStr}}` : '';
          lines.push(`${metric.name}${labelPart} ${value.value}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get metrics as JSON (for CloudWatch or custom monitoring).
   */
  getMetricsJson(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      timestamp: Date.now(),
      metrics: {},
    };

    for (const metric of this.metrics.values()) {
      if (metric.type === 'histogram') {
        const histogramMap = this.histograms.get(metric.name);
        if (histogramMap) {
          (result.metrics as Record<string, unknown>)[metric.name] = Array.from(histogramMap.values());
        }
      } else {
        (result.metrics as Record<string, unknown>)[metric.name] = metric.values;
      }
    }

    return result;
  }

  /**
   * Get a single metric value.
   */
  getMetricValue(name: string, labels: MetricLabels = {}): number | null {
    const fullName = this.prefix + name;
    const metric = this.metrics.get(fullName);
    if (!metric) return null;

    const labelKey = this.labelsToKey(labels);
    const value = metric.values.find((v) => this.labelsToKey(v.labels) === labelKey);
    return value?.value ?? null;
  }

  // ============================================================================
  // System Metrics Collection
  // ============================================================================

  /**
   * Update system metrics (call periodically).
   */
  updateSystemMetrics(): void {
    const memUsage = process.memoryUsage();
    this.gauge('memory_usage_bytes', memUsage.heapUsed, { type: 'heap_used' });
    this.gauge('memory_usage_bytes', memUsage.heapTotal, { type: 'heap_total' });
    this.gauge('memory_usage_bytes', memUsage.rss, { type: 'rss' });
    this.gauge('memory_usage_bytes', memUsage.external, { type: 'external' });

    this.gauge('uptime_seconds', process.uptime());

    // CPU usage (simplified - would need more sophisticated measurement in production)
    const cpuUsage = process.cpuUsage();
    const totalCpuTime = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
    this.gauge('cpu_usage_percent', totalCpuTime);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private labelsToKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  private labelsToPrometheus(labels: MetricLabels): string {
    return Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  /**
   * Reset all metrics (for testing).
   */
  reset(): void {
    for (const metric of this.metrics.values()) {
      metric.values = [];
    }
    for (const histogram of this.histograms.values()) {
      histogram.clear();
    }
  }
}

// Singleton instance
let instance: MetricsService | null = null;

export function getMetricsService(prefix?: string): MetricsService {
  if (!instance) {
    instance = new MetricsService(prefix);
  }
  return instance;
}

export function resetMetricsService(): void {
  instance = null;
}
