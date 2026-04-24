type RecommendedSlotAnalytics = {
  totalBookings: number;
  recommendedBookings: number;
  updatedAt: string;
};

const STORAGE_KEY = 'resvia_recommended_slot_analytics_v1';

function getDefaultAnalytics(): RecommendedSlotAnalytics {
  return {
    totalBookings: 0,
    recommendedBookings: 0,
    updatedAt: new Date(0).toISOString(),
  };
}

function readAnalytics(): RecommendedSlotAnalytics {
  if (typeof window === 'undefined') {
    return getDefaultAnalytics();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultAnalytics();

    const parsed = JSON.parse(raw) as Partial<RecommendedSlotAnalytics>;
    return {
      totalBookings: Number(parsed.totalBookings) || 0,
      recommendedBookings: Number(parsed.recommendedBookings) || 0,
      updatedAt: parsed.updatedAt || new Date(0).toISOString(),
    };
  } catch {
    return getDefaultAnalytics();
  }
}

function writeAnalytics(next: RecommendedSlotAnalytics): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function trackRecommendedSlotBooking(usedRecommendedSlot: boolean): void {
  const current = readAnalytics();
  const next: RecommendedSlotAnalytics = {
    totalBookings: current.totalBookings + 1,
    recommendedBookings: current.recommendedBookings + (usedRecommendedSlot ? 1 : 0),
    updatedAt: new Date().toISOString(),
  };

  writeAnalytics(next);
}

export function getRecommendedSlotUsageSummary(): {
  totalBookings: number;
  recommendedBookings: number;
  recommendedUsagePercent: number;
} {
  const current = readAnalytics();
  const recommendedUsagePercent =
    current.totalBookings > 0
      ? Math.round((current.recommendedBookings / current.totalBookings) * 100)
      : 0;

  return {
    totalBookings: current.totalBookings,
    recommendedBookings: current.recommendedBookings,
    recommendedUsagePercent,
  };
}
