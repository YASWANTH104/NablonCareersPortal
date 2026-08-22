import { Search, X, SlidersHorizontal, Loader2 } from 'lucide-react';
import { LOCATION_TYPES, EMPLOYMENT_TYPES } from '@/constants/jobOptions';

const selectClass =
  'text-sm border border-surface-300 rounded-xl px-3 py-2.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500';

// Search + department/work-mode/employment-type filters for the two in-portal
// job lists. GET /jobs has always accepted all three filters; nothing in the
// portal used them, so a candidate's only tool for finding a role was a title
// substring.
export default function JobFilterBar({
  search, onSearchChange,
  departmentId, onDepartmentChange,
  locationType, onLocationTypeChange,
  employmentType, onEmploymentTypeChange,
  departments,
  onClear,
  resultLabel,
  isFetching,
  placeholder = 'Search roles by title…',
}) {
  const filtersActive = Boolean(search || departmentId || locationType || employmentType);

  return (
    <div className="bg-white rounded-2xl border border-surface-200 p-3.5 sm:p-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-9 pr-9 py-2.5 border border-surface-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-gray-400 hover:bg-surface-100 flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-gray-300 hidden lg:block" />
          <select value={departmentId} onChange={(e) => onDepartmentChange(e.target.value)} className={selectClass}>
            <option value="">All departments</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select value={locationType} onChange={(e) => onLocationTypeChange(e.target.value)} className={selectClass}>
            <option value="">Any location</option>
            {LOCATION_TYPES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select value={employmentType} onChange={(e) => onEmploymentTypeChange(e.target.value)} className={selectClass}>
            <option value="">Any type</option>
            {EMPLOYMENT_TYPES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {filtersActive && (
            <button
              onClick={onClear}
              className="inline-flex items-center gap-1 px-3 py-2.5 text-sm font-medium text-gray-500 hover:text-brand-600 rounded-xl hover:bg-surface-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {resultLabel && (
        <p className="text-xs text-gray-400 mt-3 flex items-center gap-2">
          {resultLabel}
          {isFetching && <Loader2 className="w-3 h-3 animate-spin" />}
        </p>
      )}
    </div>
  );
}
