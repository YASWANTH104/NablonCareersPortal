import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, isToday, isSameDay, getHours, getMinutes } from 'date-fns';
import { layoutOverlaps, minutesIntoDay, statusStyle, typeIcon } from './calendarUtils';

const HOUR_PX = 64;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;
const GUTTER = '3.5rem';

const toPx = (minutes, startHour) => ((minutes - startHour * 60) / 60) * HOUR_PX;

/** A positioned interview block. Collapses to a single line when the slot is
    too short to fit two, so a 30-minute call never spills out of its box. */
function EventBlock({ item, startHour, isSelected, onSelect }) {
  const { event, start, end, column, columnCount } = item;
  const style = statusStyle(event.status);
  const Icon = typeIcon(event.interview_type);

  const top = toPx(minutesIntoDay(start), startHour);
  const height = Math.max(toPx(minutesIntoDay(end), startHour) - top, 22);
  const width = 100 / columnCount;
  const compact = height < 44;

  return (
    <button
      onClick={() => onSelect(event)}
      title={`${format(start, 'h:mm a')} – ${format(end, 'h:mm a')} · ${event.candidate_name ?? 'Interview'}`}
      style={{
        top,
        height,
        left: `calc(${column * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
      className={`absolute z-10 overflow-hidden rounded-lg border px-2 py-1 text-left shadow-sm transition-all ${style.block} ${
        isSelected ? 'ring-2 ring-brand-500 ring-offset-1 z-20' : ''
      }`}
    >
      <span className={`absolute left-0 inset-y-0 w-1 ${style.bar}`} />
      <span className={`block pl-1.5 ${compact ? 'flex items-center gap-1.5' : ''}`}>
        <span className="text-[11px] font-semibold tabular-nums leading-tight">
          {format(start, 'h:mm')}
        </span>
        <span className={`text-[11px] font-medium truncate ${compact ? '' : 'block leading-tight mt-0.5'}`}>
          {event.candidate_name ?? event.title ?? `Round ${event.round_number}`}
        </span>
      </span>
      {!compact && height >= 62 && (
        <span className="flex items-center gap-1 pl-1.5 mt-1 text-[10px] opacity-70">
          <Icon className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{event.title || `Round ${event.round_number}`}</span>
        </span>
      )}
    </button>
  );
}

export default function WeekCalendar({ weekStart, interviews, selectedInterviewId, onSelectInterview, fullDay }) {
  const scrollRef = useRef(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  /* Per-day placement, plus the hour window the grid has to cover. In work-hours
     mode the window starts at business hours and only widens for interviews that
     fall outside it, so a normal week isn't padded with empty midnight rows;
     full-day mode always spans the whole 24 hours. */
  const { byDay, startHour, endHour } = useMemo(() => {
    const map = new Map();
    let earliest = DEFAULT_START_HOUR;
    let latest = DEFAULT_END_HOUR;

    days.forEach((day) => {
      const dayEvents = interviews.filter((iv) => isSameDay(new Date(iv.scheduled_at), day));
      const placed = layoutOverlaps(dayEvents);
      placed.forEach(({ start, end }) => {
        earliest = Math.min(earliest, getHours(start));
        latest = Math.max(latest, getHours(end) + (getMinutes(end) > 0 ? 1 : 0));
      });
      map.set(day.toDateString(), placed);
    });

    if (fullDay) return { byDay: map, startHour: 0, endHour: 24 };
    return { byDay: map, startHour: Math.max(0, earliest), endHour: Math.min(24, Math.max(latest, earliest + 4)) };
  }, [days, interviews, fullDay]);

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour }, (_, i) => startHour + i),
    [startHour, endHour],
  );
  const gridHeight = (endHour - startHour) * HOUR_PX;

  const nowInWeek = days.some((day) => isSameDay(day, now));
  const nowTop = toPx(minutesIntoDay(now), startHour);
  const nowVisible = nowInWeek && nowTop >= 0 && nowTop <= gridHeight;

  /* Open on the working day, not on midnight. Small offsets are snapped back to
     the top so the first hour label never ends up half-scrolled out of view. */
  useEffect(() => {
    if (!scrollRef.current) return;
    const target = nowVisible ? nowTop - 120 : (9 - startHour) * HOUR_PX;
    scrollRef.current.scrollTop = target > HOUR_PX / 2 ? target : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, startHour]);

  const columns = `${GUTTER} repeat(7, minmax(6.5rem, 1fr))`;

  return (
    <div className="rounded-2xl border border-surface-200 bg-white shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[52rem]">
          {/* Day header */}
          <div
            className="grid border-b border-surface-200 bg-surface-50"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="border-r border-surface-200" />
            {days.map((day) => {
              const today = isToday(day);
              const count = (byDay.get(day.toDateString()) ?? []).length;
              return (
                <div
                  key={day.toISOString()}
                  className={`px-2 py-2 text-center border-r border-surface-200 last:border-r-0 ${today ? 'bg-brand-50/60' : ''}`}
                >
                  <p className={`text-[11px] font-semibold uppercase tracking-wide ${today ? 'text-brand-600' : 'text-gray-500'}`}>
                    {format(day, 'EEE')}
                  </p>
                  <p className="mt-0.5 flex items-center justify-center gap-1.5">
                    <span
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold tabular-nums ${
                        today ? 'bg-brand-500 text-white' : 'text-gray-800'
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                    {count > 0 && (
                      <span className="text-[10px] font-semibold text-gray-400 tabular-nums">{count}</span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Time grid */}
          <div ref={scrollRef} className="max-h-[62vh] overflow-y-auto">
            <div className="grid" style={{ gridTemplateColumns: columns }}>
              {/* Hour gutter */}
              <div className="relative border-r border-surface-200" style={{ height: gridHeight }}>
                {hours.map((hour, i) => (
                  <span
                    key={hour}
                    style={{ top: i * HOUR_PX }}
                    /* Labels straddle their hour line, except the first — there is
                       no room above the grid, so it hangs below the line instead. */
                    className={`absolute right-2 text-[10px] font-medium text-gray-400 tabular-nums ${
                      i === 0 ? 'pt-0.5' : '-translate-y-1/2'
                    }`}
                  >
                    {format(new Date(2000, 0, 1, hour), 'h a')}
                  </span>
                ))}
              </div>

              {days.map((day) => {
                const placed = byDay.get(day.toDateString()) ?? [];
                const weekend = [0, 6].includes(day.getDay());
                const today = isToday(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={`relative border-r border-surface-200 last:border-r-0 ${
                      today ? 'bg-brand-50/25' : weekend ? 'bg-surface-50/60' : ''
                    }`}
                    style={{ height: gridHeight }}
                  >
                    {hours.map((hour, i) => (
                      <div key={hour}>
                        <div
                          style={{ top: i * HOUR_PX }}
                          className="absolute inset-x-0 border-t border-surface-200/70"
                        />
                        <div
                          style={{ top: i * HOUR_PX + HOUR_PX / 2 }}
                          className="absolute inset-x-0 border-t border-dashed border-surface-100"
                        />
                      </div>
                    ))}

                    {placed.map((item) => (
                      <EventBlock
                        key={item.event.id}
                        item={item}
                        startHour={startHour}
                        isSelected={item.event.id === selectedInterviewId}
                        onSelect={onSelectInterview}
                      />
                    ))}

                    {nowVisible && isSameDay(day, now) && (
                      <div style={{ top: nowTop }} className="absolute inset-x-0 z-30 pointer-events-none">
                        <div className="relative border-t-2 border-rose-500">
                          <span className="absolute -left-1 -top-[5px] w-2 h-2 rounded-full bg-rose-500" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
