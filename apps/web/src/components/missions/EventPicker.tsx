'use client';

import { useDict } from '@web/context/dict-context';
import type { AdminEvent } from '@web/lib/admin-events-api';
import { fieldClass, fieldStyle, hintClass, hintStyle } from './form-styles';

type Props = {
  id: string;
  /** Published events. */
  events: AdminEvent[];
  /**
   * Whether each event has a price (`eventId → priced`). An unpriced event is
   * listed disabled with the reason; an event missing from the map is unknown
   * and stays selectable — the API answers `EVENT_NOT_CHARGEABLE` if it is not.
   */
  priced: Record<string, boolean>;
  value: string;
  onChange: (eventId: string) => void;
  disabled?: boolean;
};

export function EventPicker({ id, events, priced, value, onChange, disabled = false }: Props) {
  const d = useDict().admin.missions.requirements;
  const known = events.some((e) => e.id === value);

  return (
    <div>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={fieldClass}
        style={fieldStyle}
      >
        <option value="">{d.eventNone}</option>
        {value && !known && <option value={value}>{d.eventUnavailable}</option>}
        {events.map((event) => {
          const unpriced = priced[event.id] === false;
          return (
            <option key={event.id} value={event.id} disabled={unpriced && event.id !== value}>
              {unpriced ? d.eventUnpriced(event.title) : event.title}
            </option>
          );
        })}
      </select>
      {events.length === 0 && (
        <p className={hintClass} style={hintStyle}>
          {d.eventsEmpty}
        </p>
      )}
    </div>
  );
}
