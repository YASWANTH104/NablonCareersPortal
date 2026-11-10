import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  PenLine, Users, MessageSquareText, ClipboardCheck, ChevronUp, ChevronDown, X, Plus,
  Lock, ArrowRight, ArrowLeft, Send, Loader2, AlertCircle, CheckCircle2, Mail, Clock,
  BellRing, Repeat, ListOrdered, FileText, RefreshCw,
} from 'lucide-react';
import { Modal, Segmented } from '@/components/ui';
import { esignApi } from '@/api/esign';
import { offersApi } from '@/api/offers';
import { PARTY_ROLES, ASSIGNABLE_PARTY_ROLES } from '@/constants/offerStatus';
import PartyPicker, { EMAIL_RE, initials } from './PartyPicker';
import { cn } from '@/lib/utils';

const STEPS = [
  { key: 'parties', label: 'Who signs', icon: Users },
  { key: 'message', label: 'Message', icon: MessageSquareText },
  { key: 'review', label: 'Review & send', icon: ClipboardCheck },
];

const SENDING_STAGES = [
  'Preparing the letter',
  'Uploading to Zoho Sign',
  'Placing signature fields',
  'Notifying the first signer',
];

const REMINDER_OPTIONS = [1, 2, 3, 5, 7];

let uidSeq = 0;
const uid = () => `p${++uidSeq}`;

const acts = (p) => p.role !== 'viewer';
const firstName = (name = '') => name.trim().split(/\s+/)[0] || name;

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand-500' : 'bg-surface-300'
      )}
    >
      <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
    </button>
  );
}

function RoleChip({ role }) {
  const r = PARTY_ROLES[role];
  return (
    <span className={cn('inline-flex items-center text-[11px] font-semibold rounded-full border px-2 py-0.5 whitespace-nowrap', r.tone)}>
      {r.label}
    </span>
  );
}

function Stepper({ step }) {
  return (
    <ol className="flex items-center gap-1.5 sm:gap-2 mb-5">
      {STEPS.map((s, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={s.key} className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
            <span
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors',
                done && 'bg-brand-500 text-white',
                current && 'bg-brand-50 text-brand-700 ring-2 ring-brand-300',
                !done && !current && 'bg-surface-100 text-gray-400'
              )}
            >
              {done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
            </span>
            <span className={cn('text-xs font-semibold truncate', current ? 'text-gray-900' : 'text-gray-400')}>{s.label}</span>
            {i < STEPS.length - 1 && <span className={cn('h-px flex-1 min-w-3', done ? 'bg-brand-300' : 'bg-surface-200')} />}
          </li>
        );
      })}
    </ol>
  );
}

function validate(parties) {
  const errors = {};
  const seen = new Map();
  parties.forEach((p) => {
    const email = p.email.trim().toLowerCase();
    if (!p.name.trim()) errors[p.uid] = 'Add a name';
    else if (!EMAIL_RE.test(email)) errors[p.uid] = "Email doesn't look right";
    else if (seen.has(email)) errors[p.uid] = `Same email as ${parties.find((x) => x.uid === seen.get(email)).name}`;
    seen.set(email, p.uid);
  });
  return errors;
}

// "Ravindra signs first, then Priya" — the sentence HR reads to check the order is right.
function orderSentence(parties, sequential) {
  const actors = parties.filter(acts);
  if (actors.length < 2) return null;
  if (!sequential) return `Everyone gets the letter at the same time and can sign in any order.`;
  const names = actors.map((p) => firstName(p.name));
  if (names.length === 2) return `${names[0]} signs first. ${names[1]} gets the letter only after that.`;
  return `${names[0]} signs first, then ${names.slice(1, -1).join(', ')}, and finally ${names[names.length - 1]}.`;
}

function PartyCard({ party, index, total, error, onMove, onRemove, onChange, onReplace }) {
  const locked = party.role === 'candidate';
  const fixed = party.role === 'company_signatory' || locked;
  const order = acts(party) ? index + 1 : null;

  return (
    <li
      className={cn(
        'group relative rounded-xl border bg-white transition-shadow',
        error ? 'border-rose-300 ring-1 ring-rose-200' : 'border-surface-200 hover:shadow-card'
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <span
            className={cn(
              'w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center',
              order ? 'bg-gray-900 text-white' : 'bg-surface-100 text-gray-400'
            )}
            title={order ? `Step ${order} in the signing order` : 'Receives a copy, no action needed'}
          >
            {order ?? <Mail className="w-3 h-3" />}
          </span>
          <div className="flex flex-col opacity-60 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className="p-0.5 rounded text-gray-400 hover:text-gray-800 hover:bg-surface-100 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={`Move ${party.name} earlier`}
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              className="p-0.5 rounded text-gray-400 hover:text-gray-800 hover:bg-surface-100 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={`Move ${party.name} later`}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <span
          className={cn(
            'w-10 h-10 rounded-full text-sm font-bold flex items-center justify-center shrink-0',
            party.role === 'candidate' ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700'
          )}
        >
          {initials(party.name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">{party.name || 'Unnamed'}</p>
            {party.source === 'zoho_user' && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 bg-brand-50 border border-brand-100 rounded px-1.5 py-px">
                Zoho
              </span>
            )}
            {locked && <Lock className="w-3 h-3 text-gray-400" aria-label="Always included" />}
          </div>
          <p className="text-xs text-gray-500 truncate">{party.email}</p>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {fixed ? (
              <RoleChip role={party.role} />
            ) : (
              <select
                value={party.role}
                onChange={(e) => onChange({ role: e.target.value })}
                className="text-xs font-semibold border border-surface-200 rounded-full pl-2.5 pr-7 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
                aria-label={`What ${party.name} does`}
              >
                {ASSIGNABLE_PARTY_ROLES.map((r) => (
                  <option key={r} value={r}>{PARTY_ROLES[r].label}</option>
                ))}
              </select>
            )}
            {party.role === 'signer' && (
              <input
                value={party.title ?? ''}
                onChange={(e) => onChange({ title: e.target.value })}
                maxLength={80}
                placeholder="Signs as, e.g. Reporting Manager"
                className="text-xs border border-surface-200 rounded-full px-3 py-1 w-52 max-w-full focus:outline-none focus:ring-2 focus:ring-brand-300 placeholder:text-gray-400"
              />
            )}
            {party.role === 'company_signatory' && (
              <button type="button" onClick={onReplace} className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Change
              </button>
            )}
          </div>
          {error && (
            <p className="flex items-center gap-1 text-xs text-rose-600 mt-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        {!fixed && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            aria-label={`Remove ${party.name}`}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </li>
  );
}

function LetterPreview({ offerId }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let created;
    offersApi.fetchHtmlBlob(offerId)
      .then((u) => { created = u; if (alive) setUrl(u); })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; if (created) URL.revokeObjectURL(created); };
  }, [offerId]);

  return (
    <div className="rounded-xl border border-surface-200 bg-surface-100 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-surface-200">
        <FileText className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs font-medium text-gray-600">The letter they'll sign</span>
        <span className="text-[11px] text-gray-400 ml-auto">Signature boxes are added on each signer's line</span>
      </div>
      {url ? (
        <iframe title="Offer letter" src={url} className="w-full h-80 bg-white" />
      ) : (
        <div className="h-80 flex items-center justify-center text-xs text-gray-400">
          {failed ? "Couldn't load the preview — the letter itself is fine." : <Loader2 className="w-5 h-5 animate-spin" />}
        </div>
      )}
    </div>
  );
}

export default function SendForSignatureModal({ offer, onClose, onSent }) {
  const [step, setStep] = useState(0);
  const [parties, setParties] = useState(null);
  const [picker, setPicker] = useState(null); // null | 'add' | 'replace'
  const [sequential, setSequential] = useState(true);
  const [expiry, setExpiry] = useState(14);
  const [remindersOn, setRemindersOn] = useState(true);
  const [reminderDays, setReminderDays] = useState(3);
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [stage, setStage] = useState(0);
  const [sent, setSent] = useState(null);
  const stageTimer = useRef(null);

  const { data: defaults, isLoading } = useQuery({
    queryKey: ['esign-settings'],
    queryFn: () => esignApi.getSettings().then((r) => r.data),
  });

  // Seed the envelope once: company signatory → candidate → standing extras from Settings
  useEffect(() => {
    if (!defaults || parties) return;
    const seed = [];
    if (defaults.signatory_email) {
      seed.push({ uid: uid(), role: 'company_signatory', name: defaults.signatory_name || defaults.signatory_email, email: defaults.signatory_email, source: 'default' });
    }
    seed.push({ uid: uid(), role: 'candidate', name: offer.candidate_name ?? '', email: offer.candidate_email ?? '', source: 'candidate' });
    (defaults.default_parties ?? []).forEach((p) => {
      if (p.email?.toLowerCase() === offer.candidate_email?.toLowerCase()) return;
      seed.push({ uid: uid(), role: p.role, name: p.name, email: p.email, source: 'default' });
    });
    setParties(seed);
    setExpiry(defaults.expiration_days ?? 14);
    setRemindersOn(defaults.reminder_days != null);
    setReminderDays(defaults.reminder_days ?? 3);
    setNote(
      defaults.note ||
      `Hi, please review and sign the offer letter for ${offer.candidate_name ?? 'the candidate'} (${offer.designation}).`
    );
  }, [defaults, parties, offer]);

  const errors = useMemo(() => (parties ? validate(parties) : {}), [parties]);
  const hasSignatory = parties?.some((p) => p.role === 'company_signatory');
  const stepOneValid = parties && hasSignatory && Object.keys(errors).length === 0;
  const actors = parties?.filter(acts) ?? [];
  const copies = parties?.filter((p) => !acts(p)) ?? [];

  const sendMut = useMutation({
    mutationFn: () => esignApi.send(offer.id, {
      parties: parties.map(({ role, name, email, source, title }) => ({
        role, name: name.trim(), email: email.trim().toLowerCase(), source, title: title?.trim() || null,
      })),
      is_sequential: sequential,
      expiration_days: expiry,
      reminder_days: remindersOn ? reminderDays : null,
      note: note.trim() || null,
    }).then((r) => r.data),
    onMutate: () => {
      setStage(0);
      stageTimer.current = setInterval(() => setStage((s) => Math.min(s + 1, SENDING_STAGES.length - 1)), 1400);
    },
    onSettled: () => clearInterval(stageTimer.current),
    onSuccess: (detail) => {
      setSent(detail);
      onSent?.(detail);
    },
  });
  useEffect(() => () => clearInterval(stageTimer.current), []);

  const update = (id, patch) => setParties((ps) => ps.map((p) => (p.uid === id ? { ...p, ...patch } : p)));
  const move = (i, dir) => setParties((ps) => {
    const next = [...ps];
    const j = i + dir;
    if (j < 0 || j >= next.length) return ps;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const onPick = (person) => {
    if (picker === 'replace') {
      setParties((ps) => {
        const rest = ps.filter((p) => p.role !== 'company_signatory');
        const idx = ps.findIndex((p) => p.role === 'company_signatory');
        const signatory = { ...person, uid: uid(), role: 'company_signatory' };
        const next = [...rest];
        next.splice(idx === -1 ? 0 : idx, 0, signatory);
        return next;
      });
    } else {
      // New actors slot in before the copy-only people so the order stays readable
      setParties((ps) => {
        const p = { ...person, uid: uid(), role: 'signer', title: '' };
        const firstViewer = ps.findIndex((x) => x.role === 'viewer');
        if (firstViewer === -1) return [...ps, p];
        const next = [...ps];
        next.splice(firstViewer, 0, p);
        return next;
      });
    }
    setPicker(null);
  };

  const next = () => {
    if (step === 0 && !stepOneValid) { setShowErrors(true); return; }
    setStep((s) => s + 1);
  };

  // ── Sent ──
  if (sent) {
    const first = sent.signers?.filter((s) => s.is_current).map((s) => firstName(s.name));
    return (
      <Modal onClose={onClose} size="md">
        <div className="text-center py-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4 animate-in zoom-in-50 duration-300">
            <CheckCircle2 className="w-7 h-7 text-emerald-500" />
          </div>
          <h2 className="font-display text-lg font-bold text-gray-900">Out for signature</h2>
          <p className="text-sm text-gray-500 mt-1.5 max-w-sm mx-auto">
            Zoho Sign has emailed {first?.length ? <strong className="text-gray-700">{first.join(' and ')}</strong> : 'the first signer'}.
            {sequential && actors.length > 1 ? ' Everyone else gets it in turn.' : ''} You'll see each signature land on this page.
          </p>
          <div className="mt-5 text-left rounded-xl border border-surface-200 divide-y divide-surface-100">
            {[
              { icon: Mail, text: 'Each person signs from the Zoho Sign email. No portal login needed.' },
              { icon: BellRing, text: remindersOn ? `Zoho reminds anyone pending every ${reminderDays} day${reminderDays > 1 ? 's' : ''}.` : 'Automatic reminders are off. You can nudge from the tracker.' },
              { icon: CheckCircle2, text: "Once everyone signs, the offer is marked accepted and the signed PDF opens from here." },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-2.5 px-3.5 py-2.5 text-xs text-gray-600">
                <Icon className="w-4 h-4 text-gray-400 shrink-0 mt-px" /> {text}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full px-4 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  const footer = (
    <div className="flex items-center justify-between gap-3">
      {step > 0 ? (
        <button
          type="button"
          onClick={() => setStep((s) => s - 1)}
          disabled={sendMut.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      ) : (
        <button type="button" onClick={onClose} className="px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-800">
          Cancel
        </button>
      )}
      {step < STEPS.length - 1 ? (
        <button
          type="button"
          onClick={next}
          disabled={!parties}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors disabled:opacity-50"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => sendMut.mutate()}
          disabled={sendMut.isPending}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors disabled:opacity-70 min-w-[11rem] justify-center"
        >
          {sendMut.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> {SENDING_STAGES[stage]}…</>
          ) : (
            <><Send className="w-4 h-4" /> Send to {parties.length} {parties.length === 1 ? 'person' : 'people'}</>
          )}
        </button>
      )}
    </div>
  );

  return (
    <Modal
      onClose={sendMut.isPending ? undefined : onClose}
      closeOnBackdrop={false}
      size="2xl"
      icon={PenLine}
      title="Send for signature"
      description={`${offer.candidate_name ?? 'Candidate'} · ${offer.designation} · via Zoho Sign`}
      footer={footer}
    >
      <Stepper step={step} />

      {isLoading || !parties ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-xl bg-surface-50 animate-pulse" />)}
        </div>
      ) : step === 0 ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Who needs to sign?</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Numbers show the signing order. Use the arrows to reorder. Copy-only people get the signed letter once everyone's done.
            </p>
          </div>

          {!hasSignatory && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <div className="flex-1">
                Someone has to sign for Nablon.{' '}
                <button type="button" onClick={() => setPicker('replace')} className="font-semibold underline underline-offset-2">
                  Pick the company signatory
                </button>
              </div>
            </div>
          )}

          <ul className="space-y-2">
            {parties.map((p, i) => (
              <PartyCard
                key={p.uid}
                party={p}
                index={i}
                total={parties.length}
                error={showErrors ? errors[p.uid] : null}
                onMove={(dir) => move(i, dir)}
                onRemove={() => setParties((ps) => ps.filter((x) => x.uid !== p.uid))}
                onChange={(patch) => update(p.uid, patch)}
                onReplace={() => setPicker('replace')}
              />
            ))}
          </ul>

          {picker ? (
            <PartyPicker
              title={picker === 'replace' ? 'Who signs for Nablon?' : 'Add someone to this envelope'}
              takenEmails={parties.filter((p) => !(picker === 'replace' && p.role === 'company_signatory')).map((p) => p.email)}
              onPick={onPick}
              onCancel={() => setPicker(null)}
            />
          ) : (
            parties.length < 10 && (
              <button
                type="button"
                onClick={() => setPicker('add')}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-surface-300 text-sm font-semibold text-gray-600 hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50/40 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add a party
                <span className="font-normal text-gray-400 hidden sm:inline">· a reporting manager, HR, or anyone who needs a copy</span>
              </button>
            )
          )}

          <div className="flex items-start gap-3 rounded-xl bg-surface-50 border border-surface-200 p-3.5">
            <ListOrdered className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">Sign in order</p>
              <p className="text-xs text-gray-500 mt-0.5">{orderSentence(parties, sequential) ?? 'Add at least two people who sign.'}</p>
            </div>
            <Toggle checked={sequential} onChange={setSequential} label="Sign in order" />
          </div>
        </div>
      ) : step === 1 ? (
        <div className="space-y-5">
          <div>
            <label className="block">
              <span className="text-sm font-semibold text-gray-900">Message to signers</span>
              <span className="block text-xs text-gray-500 mt-0.5 mb-2">Zoho Sign includes this in every signing email.</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={4}
                className="w-full px-3 py-2.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300 resize-none"
              />
            </label>
            <p className="text-[11px] text-gray-400 text-right mt-1">{note.length}/1000</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-surface-200 p-3.5">
              <div className="flex items-center gap-2 mb-2.5">
                <Clock className="w-4 h-4 text-gray-400" />
                <p className="text-sm font-semibold text-gray-900">Link expires after</p>
              </div>
              <Segmented
                size="sm"
                fullWidth
                value={expiry}
                onChange={setExpiry}
                options={[...new Set([7, 14, 30, defaults?.expiration_days ?? 14])].sort((a, b) => a - b).map((d) => ({ value: d, label: `${d} days` }))}
              />
              <p className="text-[11px] text-gray-500 mt-2">
                Unsigned by {new Date(Date.now() + expiry * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}? The offer expires.
              </p>
            </div>

            <div className="rounded-xl border border-surface-200 p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-gray-400" />
                  <p className="text-sm font-semibold text-gray-900">Automatic reminders</p>
                </div>
                <Toggle checked={remindersOn} onChange={setRemindersOn} label="Automatic reminders" />
              </div>
              {remindersOn ? (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  Every
                  <select
                    value={reminderDays}
                    onChange={(e) => setReminderDays(Number(e.target.value))}
                    className="border border-surface-200 rounded-lg px-2 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-300"
                  >
                    {REMINDER_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  {reminderDays === 1 ? 'day' : 'days'} until they sign
                </div>
              ) : (
                <p className="text-xs text-gray-500">Off. You can still send a reminder from the tracker.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-surface-200 overflow-hidden">
            <div className="px-3.5 py-2.5 bg-surface-50 border-b border-surface-200 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700">What happens next</p>
              <p className="text-[11px] text-gray-500">
                Expires in {expiry} days · {remindersOn ? `reminders every ${reminderDays}d` : 'no auto-reminders'}
              </p>
            </div>
            <ol className="divide-y divide-surface-100">
              {actors.map((p, i) => (
                <li key={p.uid} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 truncate">
                      <span className="font-semibold">{p.name}</span>{' '}
                      <span className="text-gray-500">{PARTY_ROLES[p.role].verb}{p.role === 'signer' && p.title ? ` as ${p.title}` : ''}</span>
                    </p>
                    <p className="text-xs text-gray-500 truncate">{p.email}</p>
                  </div>
                  <span className="text-[11px] text-gray-500 text-right shrink-0">
                    {!sequential || i === 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><Mail className="w-3 h-3" /> Emailed now</span>
                    ) : (
                      `After ${firstName(actors[i - 1].name)}`
                    )}
                  </span>
                </li>
              ))}
              {copies.length > 0 && (
                <li className="flex items-center gap-3 px-3.5 py-2.5 bg-surface-50/60">
                  <span className="w-6 h-6 rounded-full bg-surface-100 text-gray-400 flex items-center justify-center shrink-0">
                    <Mail className="w-3 h-3" />
                  </span>
                  <p className="text-xs text-gray-600">
                    <span className="font-semibold text-gray-800">{copies.map((p) => p.name).join(', ')}</span> {copies.length === 1 ? 'gets' : 'get'} the signed copy when everyone's done.
                  </p>
                </li>
              )}
            </ol>
          </div>

          <LetterPreview offerId={offer.id} />

          {sendMut.isError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Nothing was sent</p>
                <p className="text-xs mt-0.5">
                  {typeof sendMut.error?.response?.data?.detail === 'string'
                    ? sendMut.error.response.data.detail
                    : sendMut.error?.code === 'ECONNABORTED'
                      ? 'Zoho Sign took too long to answer. Check the tracker in a minute before trying again.'
                      : 'Something went wrong talking to Zoho Sign. Please try again.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
