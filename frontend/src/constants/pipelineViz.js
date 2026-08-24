// Colours for the agency pipeline funnel, validated with the data-viz
// validator rather than picked by eye:
//
//   node scripts/validate_palette.js "#1baf7a,#eda100,#e34948" --mode light \
//        --surface "#ffffff" --pairs all
//   → ALL CHECKS PASS (worst all-pairs CVD ΔE 6.9 deutan, normal-vision 20.8)
//
// Two consequences that are requirements, not preferences:
//
//  1. CVD ΔE lands in the 6–8 band, which is only legal WITH secondary
//     encoding. Every funnel therefore ships a legend carrying the label and
//     the count — never a bare coloured bar. The obvious alternative
//     (emerald/amber/rose straight off the Tailwind ramp) measures ΔE 3.9
//     between "hired" and "not proceeding" for a deuteranope: the two ends of
//     the funnel, indistinguishable, in the one chart where that matters most.
//  2. All three sit under 3:1 against white, so the labels are mandatory for
//     contrast relief too.
//
// Order is fixed and follows the funnel, never the data — a filter that drops
// a stage must not repaint the survivors.
export const PIPELINE_STAGES = [
  { key: 'inProgress', label: 'In progress', color: '#eda100' },
  { key: 'hired', label: 'Hired', color: '#1baf7a' },
  { key: 'rejected', label: 'Not proceeding', color: '#e34948' },
];

export const PIPELINE_COLORS = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s.color]));
