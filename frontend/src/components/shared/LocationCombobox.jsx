import { useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { ALL_LOCATIONS } from '@/constants/locations';

const MAX_SUGGESTIONS = 8;

function rankMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_LOCATIONS.slice(0, MAX_SUGGESTIONS);

  const startsWith = [];
  const contains = [];
  for (const loc of ALL_LOCATIONS) {
    const city = loc.split(',')[0].toLowerCase();
    const full = loc.toLowerCase();
    if (city.startsWith(q)) startsWith.push(loc);
    else if (full.includes(q)) contains.push(loc);
  }
  return [...startsWith, ...contains].slice(0, MAX_SUGGESTIONS);
}

// Typeahead for the job "Location" field — suggests from a curated India/US
// city list as HR types (matches from the first few letters), but never
// blocks a free-text value that isn't in the list. Controlled like a plain
// text input so it drops straight into react-hook-form's <Controller>.
export default function LocationCombobox({ value, onChange, placeholder, className = '' }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimeout = useRef(null);

  const suggestions = useMemo(() => rankMatches(value || ''), [value]);

  const choose = (loc) => {
    onChange(loc);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && suggestions[highlight]) {
      e.preventDefault();
      choose(suggestions[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={value || ''}
          placeholder={placeholder || 'e.g. Bangalore, Karnataka, India'}
          onChange={(e) => { onChange(e.target.value); setHighlight(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onBlur={() => { blurTimeout.current = setTimeout(() => setOpen(false), 120); }}
          className={`w-full pl-9 pr-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent ${className}`}
        />
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border border-surface-200 rounded-lg shadow-modal py-1">
          {suggestions.map((loc, i) => (
            <li key={loc}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(loc); }}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-2 text-sm ${
                  i === highlight ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-surface-50'
                }`}
              >
                {loc}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
