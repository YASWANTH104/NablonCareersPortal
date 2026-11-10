// One status map for every offer surface — the builder, the Offers list and
// the applicant's Offer tab each kept their own copy, and they had drifted
// (the applicant tab had no director states and showed a grey raw value).
export const OFFER_STATUS = {
  draft:              { label: 'Draft',                        color: 'text-gray-600 bg-gray-100',     dot: 'bg-gray-400' },
  pending_director:   { label: 'Awaiting Director Approval',   color: 'text-amber-700 bg-amber-50',    dot: 'bg-amber-400' },
  director_rejected:  { label: 'Declined by Signatory',        color: 'text-red-700 bg-red-50',        dot: 'bg-red-500' },
  sent:               { label: 'Awaiting Candidate Signature', color: 'text-blue-700 bg-blue-50',      dot: 'bg-blue-500' },
  pending_signatures: { label: 'Out for Signature',            color: 'text-brand-700 bg-brand-50',    dot: 'bg-brand-500' },
  signature_declined: { label: 'Signature Declined',           color: 'text-red-700 bg-red-50',        dot: 'bg-red-500' },
  accepted:           { label: 'Signed & Accepted',            color: 'text-green-700 bg-green-50',    dot: 'bg-green-500' },
  rejected:           { label: 'Declined by Candidate',        color: 'text-red-700 bg-red-50',        dot: 'bg-red-500' },
  revoked:            { label: 'Revoked',                      color: 'text-orange-700 bg-orange-50',  dot: 'bg-orange-400' },
  expired:            { label: 'Expired',                      color: 'text-yellow-700 bg-yellow-50',  dot: 'bg-yellow-500' },
};

export function offerStatus(status) {
  return OFFER_STATUS[status] ?? {
    label: (status ?? 'unknown').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    color: 'text-gray-600 bg-gray-100',
    dot: 'bg-gray-400',
  };
}

// Statuses HR can still edit and (re)send from — mirrors offer_service.EDITABLE_STATUSES
export const EDITABLE_OFFER_STATUSES = ['draft', 'director_rejected', 'signature_declined'];

// Zoho Sign party roles, in the words HR sees in the dialog
export const PARTY_ROLES = {
  company_signatory: { label: 'Signs for Nablon', short: 'Company signatory', verb: 'signs', tone: 'bg-brand-50 text-brand-700 border-brand-200' },
  candidate:         { label: 'Candidate',        short: 'Candidate',         verb: 'signs', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  signer:            { label: 'Also signs',       short: 'Signer',            verb: 'signs', tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  approver:          { label: 'Approves',         short: 'Approver',          verb: 'approves', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  viewer:            { label: 'Gets a copy',      short: 'Copy only',         verb: 'gets a copy', tone: 'bg-surface-100 text-gray-600 border-surface-200' },
};

// Roles HR can switch an added party between (the two fixed lines aren't swappable)
export const ASSIGNABLE_PARTY_ROLES = ['signer', 'approver', 'viewer'];
