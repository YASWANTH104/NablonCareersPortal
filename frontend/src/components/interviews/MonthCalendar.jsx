import { useMemo } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday, isSameDay,
} from 'date-fns';
import { groupByDayKey, dayKey, statusStyle } from './calendarUtils';
import { toIST } from '@/utils/formatters';

const WEEK_STARTS_ON = 1; // Monday — interviews cluster in the work week
const MAX_CHIPS = 3;

/** One interview inside a day cell: a status-coloured bar, the start time, and
    whoever is being interviewed. Time first, because that is what people scan for. */
function DayChip({ interview, onSelect }) {
  const style = statusStyle(interview.status);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onSelect(interview); }}
      title={`${format(toIST(interview.scheduled_at), 'h:mm a')} IST · ${interview.candidate_name ?? 'Interview'}`}
      className={`group w-full flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-md border text-left transition-colors ${style.chip}`}
    >
      <span className={`w-1 h-3.5 rounded-full flex-shrink-0 ${style.bar}`} />
      <span className="text-[11px] font-semibold tabular-nums flex-shrink-0">
        {format(toIST(interview.scheduled_at), 'h:mm')}
      </span>
      <span className="text-[11px] truncate">
        {interview.candidate_name ?? interview.title ?? `Round ${interview.round_number}`}
      </span>
    </button>
  );
}

export default function MonthCalendar({
  month,
  interviews,
  selectedDay,
  onSelectDay,
  onSelectInterview,
  onExpandDay,
}) {
  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: WEEK_STARTS_ON }),
    end:   endOfWeek(endOfMonth(month), { weekStartsOn: WEEK_STARTS_ON }),
  }), [month]);

  const byDay = useMemo(() => groupByDayKey(interviews), [interviews]);
  const weekdayLabels = days.slice(0, 7);

  return (
    <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-card">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-surface-200 bg-surface-50">
        {weekdayLabels.map((day) => (
          <div
            key={day.toISOString()}
            className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500"
          >
            <span className="hidden sm:inline">{format(day, 'EEE')}</span>
            <span className="sm:hidden">{format(day, 'EEEEE')}</span>
          </div>
        ))}
      </div>

      {/* Day grid — 1px gaps on a tinted backdrop draw the rules without borders
          doubling up between adjacent cells. */}
      <div role="grid" className="grid grid-cols-7 gap-px bg-surface-200">
        {days.map((day) => {
          const key = dayKey(day);
          const dayInterviews = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, month);
          const today = isToday(day);
          const selected = selectedDay && isSameDay(day, selectedDay);
          const overflow = dayInterviews.length - MAX_CHIPS;

          return (
            <div
              key={key}
              onClick={() => onSelectDay(day)}
              role="gridcell"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectDay(day); } }}
              className={`relative min-h-[4.25rem] sm:min-h-[7.5rem] p-1.5 sm:p-2 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
                inMonth ? 'bg-white hover:bg-surface-50' : 'bg-surface-50/70 hover:bg-surface-100/70'
              } ${selected ? 'ring-2 ring-inset ring-brand-400 bg-brand-50/40' : ''}`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold tabular-nums ${
                    today
                      ? 'bg-brand-500 text-white'
                      : inMonth ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  {format(day, 'd')}
                </span>
                {dayInterviews.length > 0 && (
                  <span className="text-[10px] font-semibold text-gray-400 tabular-nums">
                    {dayInterviews.length}
                  </span>
                )}
              </div>

              {/* Chips on comfortable widths */}
              <div className="hidden sm:block space-y-1">
                {dayInterviews.slice(0, MAX_CHIPS).map((interview) => (
                  <DayChip key={interview.id} interview={interview} onSelect={onSelectInterview} />
                ))}
                {overflow > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onExpandDay(day); }}
                    className="w-full text-left text-[11px] font-semibold text-brand-600 hover:text-brand-700 px-1.5 py-0.5"
                  >
                    +{overflow} more
                  </button>
                )}
              </div>

              {/* Dots on narrow screens, where chips would be unreadable */}
              <div className="sm:hidden flex flex-wrap gap-1">
                {dayInterviews.slice(0, 6).map((interview) => (
                  <span
                    key={interview.id}
                    className={`w-1.5 h-1.5 rounded-full ${statusStyle(interview.status).dot}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
