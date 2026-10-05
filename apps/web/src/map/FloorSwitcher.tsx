import { useI18n } from '../i18n';
import { floorLabel } from './floors';
import type { MapPanel } from './types';

interface Props {
  panels: MapPanel[];
  value: number;
  onChange: (panel: number) => void;
}

/** Floors as a radio group: arrow keys move between them, and it works without the map. */
export function FloorSwitcher({ panels, value, onChange }: Props) {
  const { t } = useI18n();
  return (
    <fieldset className="floor-switcher">
      <legend>{t.floorSwitcherLegend}</legend>
      <div className="floor-options">
        {panels.map((p) => {
          const id = `floor-${p.panel}`;
          return (
            <div key={p.panel} className="floor-option">
              <input
                type="radio"
                name="floor"
                id={id}
                value={p.panel}
                checked={p.panel === value}
                onChange={() => {
                  onChange(p.panel);
                }}
              />
              <label htmlFor={id}>{floorLabel(p.panel, t)}</label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
