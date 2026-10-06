import { fmt, useI18n } from '../i18n';

/**
 * Says how far to trust the guidance for a station: full detail inside (tier 2) or between
 * stations only (tier 1). The tier is always written out, never only a colour or an icon, and the
 * one-line explanation can be left out where the page already explains it nearby.
 */
export function TierBadge({ tier, explain = true }: { tier: 1 | 2; explain?: boolean }) {
  const { t } = useI18n();
  const info = tier === 2 ? t.tierBadge.tier2 : t.tierBadge.tier1;
  return (
    <span className="tier-badge" data-tier={tier}>
      <span className="tier-tag">{fmt(t.tierBadge.label, { tier: info.name })}</span>
      {explain && <span className="step-note">{info.explain}</span>}
    </span>
  );
}
