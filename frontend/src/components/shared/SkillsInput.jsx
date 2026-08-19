import { useState } from 'react';
import { X } from 'lucide-react';

export default function SkillsInput({ value = [], onChange, placeholder = 'Type a skill and press Enter' }) {
  const [draft, setDraft] = useState('');

  const addSkill = () => {
    const skill = draft.trim();
    if (!skill) return;
    if (!value.some((s) => s.toLowerCase() === skill.toLowerCase())) {
      onChange([...value, skill]);
    }
    setDraft('');
  };

  const removeSkill = (skill) => onChange(value.filter((s) => s !== skill));

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-brand-50 text-brand-700"
          >
            {skill}
            <button type="button" onClick={() => removeSkill(skill)} className="text-brand-400 hover:text-brand-700">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addSkill();
          }
        }}
        onBlur={addSkill}
        placeholder={placeholder}
        className="w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );
}
