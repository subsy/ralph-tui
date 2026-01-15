/**
 * ABOUTME: System resource monitoring utilities for the worktree pool manager.
 * Provides functions to check CPU and memory availability before spawning worktrees.
 */

import { cpus, freemem, totalmem } from 'node:os';
import type { SystemResources } from './types.js';

let lastCpuInfo: { idle: number; total: number } | null = null;

function getCpuTimes(): { idle: number; total: number } {
  const cpuList = cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpuList) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }

  return { idle, total };
}

export async function getCpuUtilization(): Promise<number> {
  const current = getCpuTimes();

  if (!lastCpuInfo) {
    lastCpuInfo = current;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return getCpuUtilization();
  }

  const idleDiff = current.idle - lastCpuInfo.idle;
  const totalDiff = current.total - lastCpuInfo.total;

  lastCpuInfo = current;

  if (totalDiff === 0) {
    return 0;
  }

  const utilization = ((totalDiff - idleDiff) / totalDiff) * 100;
  return Math.round(utilization * 100) / 100;
}

export function getMemoryInfo(): { totalMB: number; freeMB: number } {
  const totalBytes = totalmem();
  const freeBytes = freemem();

  return {
    totalMB: Math.round(totalBytes / (1024 * 1024)),
    freeMB: Math.round(freeBytes / (1024 * 1024)),
  };
}

export async function getSystemResources(): Promise<SystemResources> {
  const memory = getMemoryInfo();
  const cpuUtilization = await getCpuUtilization();
  const cpuCores = cpus().length;

  return {
    totalMemoryMB: memory.totalMB,
    freeMemoryMB: memory.freeMB,
    cpuUtilization,
    cpuCores,
    timestamp: new Date(),
  };
}

export interface ResourceCheckResult {
  canProceed: boolean;
  reason?: 'insufficient_memory' | 'high_cpu_utilization';
  resources: SystemResources;
}

export async function checkResourceAvailability(
  minFreeMemoryMB: number,
  maxCpuUtilization: number
): Promise<ResourceCheckResult> {
  const resources = await getSystemResources();

  if (resources.freeMemoryMB < minFreeMemoryMB) {
    return {
      canProceed: false,
      reason: 'insufficient_memory',
      resources,
    };
  }

  if (resources.cpuUtilization > maxCpuUtilization) {
    return {
      canProceed: false,
      reason: 'high_cpu_utilization',
      resources,
    };
  }

  return {
    canProceed: true,
    resources,
  };
}
