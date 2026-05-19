// ============================================================
// rewards.tsx — React SDK rewards surface
//
// Exports:
//   useReputation()     — current user's point totals
//   useTier()           — current user's tier
//   <MushiRewardsBadge /> — polymorphic drop-in badge component
// ============================================================

import { useState, useEffect, type ElementType, type ComponentPropsWithoutRef } from 'react';
import type { MushiReputationResult, MushiTierResult } from '@mushi-mushi/core';
import { useMushi } from './hooks';

// ──────────────────────────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────────────────────────

/** Returns the current user's reputation totals, or null if unavailable. */
export function useReputation(): MushiReputationResult | null {
  const sdk = useMushi();
  const [reputation, setReputation] = useState<MushiReputationResult | null>(null);

  useEffect(() => {
    if (!sdk) return;
    let cancelled = false;
    sdk.getReputation().then((rep) => {
      if (!cancelled) setReputation(rep);
    });
    return () => { cancelled = true; };
  }, [sdk]);

  return reputation;
}

/** Returns the current user's tier, or null if unavailable. */
export function useTier(): MushiTierResult | null {
  const sdk = useMushi();
  const [tier, setTier] = useState<MushiTierResult | null>(null);

  useEffect(() => {
    if (!sdk) return;
    let cancelled = false;
    sdk.getTier().then((t) => {
      if (!cancelled) setTier(t);
    });
    return () => { cancelled = true; };
  }, [sdk]);

  return tier;
}

// ──────────────────────────────────────────────────────────────
// <MushiRewardsBadge />
// Polymorphic: renders as a <span> by default but accepts any
// element type via the `as` prop (e.g. <MushiRewardsBadge as="div" />).
// ──────────────────────────────────────────────────────────────

type AsProp<C extends ElementType> = { as?: C };
type PropsToOmit<C extends ElementType, P> = keyof (AsProp<C> & P);
type PolymorphicComponentProp<C extends ElementType, Props = Record<string, never>> =
  React.PropsWithChildren<Props & AsProp<C>> &
  Omit<ComponentPropsWithoutRef<C>, PropsToOmit<C, Props>>;

interface BadgeOwnProps {
  /** Show a numeric point count alongside the tier name. Default false. */
  showPoints?: boolean;
  /** Fallback content while data is loading. Default: null (nothing). */
  loadingFallback?: React.ReactNode;
  /** Custom class name applied to the rendered element. */
  className?: string;
}

type MushiRewardsBadgeProps<C extends ElementType = 'span'> =
  PolymorphicComponentProp<C, BadgeOwnProps>;

const TIER_COLOR_MAP: Record<string, string> = {
  free: '#6b7280',
  explorer: '#3b82f6',
  contributor: '#8b5cf6',
  champion: '#f59e0b',
};

export function MushiRewardsBadge<C extends ElementType = 'span'>({
  as,
  showPoints = false,
  loadingFallback = null,
  className,
  ...rest
}: MushiRewardsBadgeProps<C>) {
  const Component = (as ?? 'span') as ElementType;
  const tier = useTier();
  const reputation = useReputation();

  if (!tier) return <>{loadingFallback}</>;

  const color = TIER_COLOR_MAP[tier.slug] ?? '#6c47ff';
  const label = showPoints && reputation
    ? `${tier.displayName} · ${reputation.totalPoints.toLocaleString()} pts`
    : tier.displayName;

  return (
    <Component
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
      title={`${reputation?.totalPoints.toLocaleString() ?? 0} points — ${tier.displayName}`}
      {...rest}
    >
      <span
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
        }}
        aria-hidden
      />
      <span>{label}</span>
    </Component>
  );
}
