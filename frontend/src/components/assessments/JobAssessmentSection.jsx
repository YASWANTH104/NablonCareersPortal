import { ClipboardCheck } from 'lucide-react';
import { ASSESSMENT_PRESETS } from '@/constants/assessmentPresets';
import { SCORE_BAR, TRUST_BAR } from '@/constants/assessmentResults';

const inputCls =
  'w-full text-sm border border-surface-300 rounded-lg px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-400 disabled:bg-surface-50 disabled:text-gray-400';
const CUSTOM = '__custom__';
// This section sits inside the job editor's <form>: Enter in one of these
// fields must not submit the whole job.
const noSubmit = (e) => { if (e.key === 'Enter') e.preventDefault(); };

export const EMPTY_JOB_ASSESSMENT = {
  preset: '',
  assessment_link: '',
  assessment_title: '',
  assessment_duration_mins: '',
  assessment_deadline_days: '7',
  assessment_pass_stage: '',
};

const PASS_STAGE_OPTIONS = [
  { value: '', label: 'Pipeline default' },
  { value: 'tr1', label: 'Technical Round 1' },
  { value: 'screening', label: 'HR Screening call' },
];

// API shape -> form state (the preset is derived from the link).
export function jobAssessmentFromApi(d) {
  if (!d?.assessment_link) return { ...EMPTY_JOB_ASSESSMENT };
  const match = ASSESSMENT_PRESETS.find((p) => p.url === d.assessment_link);
  return {
    preset: match ? match.label : CUSTOM,
    assessment_link: d.assessment_link,
    assessment_title: d.assessment_title ?? '',
    assessment_duration_mins: d.assessment_duration_mins ?? '',
    assessment_deadline_days: d.assessment_deadline_days ?? '7',
    assessment_pass_stage: d.assessment_pass_stage ?? '',
  };
}

// Form state -> PUT /jobs/{id}/assessment body. No link = unmapped.
export function jobAssessmentToBody(v) {
  const num = (x) => (x === '' || x == null ? null : Number(x));
  const link = (v.assessment_link || '').trim();
  if (!v.preset || !link) return { assessment_link: null };
  return {
    assessment_link: link,
    assessment_title: (v.assessment_title || '').trim() || null,
    assessment_duration_mins: num(v.assessment_duration_mins),
    assessment_deadline_days: num(v.assessment_deadline_days),
    assessment_pass_stage: v.assessment_pass_stage || null,
  };
}

// Checked before the job is saved, so a half-filled mapping never saves the
// job and then fails on the assessment.
export function jobAssessmentError(v) {
  if (!v.preset) return null;
  const link = (v.assessment_link || '').trim();
  if (!link) return 'Assessment: pick a test or paste its link';
  if (!link.startsWith('https://')) return 'Assessment: the test link must start with https://';
  const d = Number(v.assessment_deadline_days);
  if (v.assessment_deadline_days !== '' && (!Number.isInteger(d) || d < 1 || d > 30)) {
    return 'Assessment: deadline must be 1–30 days';
  }
  return null;
}

// The role's auto-sent assessment, edited as part of the job form and saved
// with it (JobEditPage). Stored through an HR-only endpoint, because the job
// record itself is served on the public job pages and must never carry the
// test link.
export default function JobAssessmentSection({ value, onChange }) {
  const v = value;
  const set = (k) => (e) => onChange({ ...v, [k]: e.target.value });
  const mapped = !!v.preset;

  const pickPreset = (e) => {
    const label = e.target.value;
    if (!label) return onChange({ ...EMPTY_JOB_ASSESSMENT });
    const p = ASSESSMENT_PRESETS.find((x) => x.label === label);
    if (p && p.url !== CUSTOM) {
      onChange({ ...v, preset: label, assessment_link: p.url, assessment_title: v.assessment_title || p.label });
    } else {
      onChange({ ...v, preset: CUSTOM, assessment_link: v.preset === CUSTOM ? v.assessment_link : '' });
    }
  };
  // Editing the link by hand turns the choice into a custom link.
  const editLink = (e) => {
    const link = e.target.value;
    const match = ASSESSMENT_PRESETS.find((p) => p.url === link.trim());
    onChange({ ...v, assessment_link: link, preset: match ? match.label : CUSTOM });
  };
  const passTarget = v.assessment_pass_stage === 'screening' ? 'the HR Screening call'
    : v.assessment_pass_stage === 'tr1' ? 'Technical Round 1' : 'the next round';

  return (
    <section className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center flex-shrink-0">
          <ClipboardCheck className="w-4 h-4 text-brand-600" />
        </div>
        <div className="flex-1">
          <h2 className="font-display font-semibold text-gray-900 text-base">
            Assessment {mapped && <span className="ml-1.5 align-middle text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">Auto-send on</span>}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            When a candidate is moved to <strong>Assessment</strong>, this test is emailed to them automatically.
            Leave it as “Not mapped” to keep scheduling assessments by hand. Saved with the job.
          </p>
        </div>
      </div>

      <div className="sm:pl-12 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-700 mb-1.5">Test</span>
            <select value={v.preset} onChange={pickPreset} className={inputCls}>
              <option value="">Not mapped</option>
              {ASSESSMENT_PRESETS.map((p) => (
                <option key={p.label} value={p.url === CUSTOM ? CUSTOM : p.label}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-700 mb-1.5">Title in the email</span>
            <input onKeyDown={noSubmit} value={v.assessment_title} onChange={set('assessment_title')} placeholder="e.g. AI Engineer assessment" className={inputCls} disabled={!mapped} />
          </label>
        </div>

        <label className="block">
          <span className="block text-xs font-semibold text-gray-700 mb-1.5">Assessment link</span>
          <input
            onKeyDown={noSubmit}
            value={v.assessment_link}
            onChange={editLink}
            placeholder="https://www.autoproctor.co/tests/…/instructions/"
            className={inputCls}
            disabled={!mapped}
          />
          <span className="block text-[11px] text-gray-400 mt-1">Filled in from the test you pick — or paste any test link here.</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-700 mb-1.5">Duration (minutes)</span>
            <input onKeyDown={noSubmit} type="number" min="1" value={v.assessment_duration_mins} onChange={set('assessment_duration_mins')} placeholder="Optional" className={inputCls} disabled={!mapped} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-700 mb-1.5">Deadline (days after sending)</span>
            <input onKeyDown={noSubmit} type="number" min="1" max="30" value={v.assessment_deadline_days} onChange={set('assessment_deadline_days')} className={inputCls} disabled={!mapped} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-700 mb-1.5">After passing, move to</span>
            <select value={v.assessment_pass_stage} onChange={set('assessment_pass_stage')} className={inputCls} disabled={!mapped}>
              {PASS_STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <div className="bg-surface-50 border border-surface-200 rounded-lg px-3.5 py-3 text-xs text-gray-600 leading-relaxed">
          <p className="font-semibold text-gray-700 mb-1">After it's sent (AutoProctor results sync every night):</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>
              Score <strong>≥ {SCORE_BAR}%</strong> and trust <strong>≥ {TRUST_BAR}%</strong> → moved to <strong>{passTarget}</strong>
              {!v.assessment_pass_stage && ' (pipeline default: agency candidates to Screening, everyone else to TR1)'}.
            </li>
            <li>Below either → <strong>Rejected</strong>, and the rejection email goes out right away.</li>
            <li>Not submitted yet → reminder emails on <strong>day 3</strong> and <strong>day 6</strong> after sending (10:00 AM IST).</li>
            <li>Nothing submitted <strong>30 days</strong> after sending → <strong>Interview Drop</strong>.</li>
            <li>Only candidates still in the Assessment stage are moved — anyone you've moved on is left alone.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
