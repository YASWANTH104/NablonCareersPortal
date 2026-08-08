import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, closestCorners,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { formatDistanceToNow } from 'date-fns';
import { Search, LayoutGrid, List, Star, GripVertical, X, UserPlus, UploadCloud, AlertTriangle, Pause } from 'lucide-react';
import toast from 'react-hot-toast';
import { applicationsApi } from '@/api/applications';
import { jobsApi } from '@/api/jobs';
import { agenciesApi } from '@/api/agencies';
import { uploadsApi } from '@/api/uploads';
import CandidateIntakeForm from '@/components/shared/CandidateIntakeForm';
import BulkUploadModal from '@/components/shared/BulkUploadModal';
import StageReasonDialog from '@/components/shared/StageReasonDialog';
import HoldReasonDialog from '@/components/shared/HoldReasonDialog';
import { useHoldToggle } from '@/hooks/useHoldToggle';
import { PIPELINE_STAGES, STAGE_MAP, REASON_REQUIRED_STAGES } from '@/constants/pipelineStages';

function initials(name) {
  return (name ?? '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ── Kanban Card ──────────────────────────────────────────────────────────────

function KanbanCard({ application, onClick, onToggleHold }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
    data: { fromStage: application.stage },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)` }
    : undefined;

  const name = application.applicant?.full_name ?? 'Unknown';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-lg border p-3 hover:shadow-sm transition-all ${
        application.on_hold ? 'border-amber-200' : 'border-surface-200 hover:border-brand-300'
      } ${isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-pointer'}`}
      onClick={() => !isDragging && onClick(application.id)}
    >
      <div className="flex items-start gap-2 mb-2">
        <div
          {...listeners}
          {...attributes}
          className="mt-0.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-brand-700">
          {initials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate leading-tight">{name}</p>
          <p className="text-xs text-gray-400 truncate">{application.applicant?.email}</p>
        </div>
        {application.duplicate_flag && !application.duplicate_reviewed_at && (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" title="Possible duplicate candidate" />
        )}
        {application.is_starred && (
          <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400 flex-shrink-0" />
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleHold(application); }}
          className={`p-0.5 rounded flex-shrink-0 transition-colors ${
            application.on_hold ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-gray-500'
          }`}
          title={
            application.on_hold
              ? `On hold${application.hold_reason ? `: ${application.hold_reason}` : ''} — click to resume`
              : 'Put on hold'
          }
        >
          <Pause className="w-3.5 h-3.5" />
        </button>
      </div>
      {application.on_hold && (
        <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 mb-1.5">
          On Hold
        </span>
      )}
      <div className="flex items-center justify-between mt-2">
        {application.rating ? (
          <div className="flex gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`w-2.5 h-2.5 ${
                  i < application.rating
                    ? 'text-yellow-400 fill-yellow-400'
                    : 'text-gray-200'
                }`}
              />
            ))}
          </div>
        ) : (
          <span />
        )}
        <span className="text-xs text-gray-400">
          {formatDistanceToNow(new Date(application.applied_at), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({ stageKey, label, colorClass, cards, onCardClick, onToggleHold }) {
  const { isOver, setNodeRef } = useDroppable({ id: stageKey });

  return (
    <div className="flex-shrink-0 w-56">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colorClass}`}>
          {label}
        </span>
        <span className="text-xs text-gray-400 font-medium">{cards.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-24 rounded-xl p-2 space-y-2 transition-colors ${
          isOver ? 'bg-brand-50 border-2 border-dashed border-brand-300' : 'bg-surface-50'
        }`}
      >
        {cards.map((app) => (
          <KanbanCard key={app.id} application={app} onClick={onCardClick} onToggleHold={onToggleHold} />
        ))}
      </div>
    </div>
  );
}

// ── Kanban View ───────────────────────────────────────────────────────────────

function KanbanView({ applications, queryKey, onCardClick, onToggleHold }) {
  const queryClient = useQueryClient();
  const [activeApp, setActiveApp] = useState(null);
  const [pendingDrop, setPendingDrop] = useState(null); // { app, toStage }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Touch needs a press-and-hold to start a drag, otherwise every attempt to
    // scroll the board (or the page) would be read as dragging a card.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  );

  const grouped = useMemo(() => {
    const map = {};
    PIPELINE_STAGES.forEach((s) => (map[s.key] = []));
    applications.forEach((app) => {
      if (map[app.stage] !== undefined) map[app.stage].push(app);
    });
    return map;
  }, [applications]);

  const stageMutation = useMutation({
    mutationFn: ({ id, stage, rejection_reason, drop_category }) =>
      applicationsApi.moveStage(id, stage, undefined, rejection_reason, drop_category),
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((a) => (a.id === id ? { ...a, stage } : a)),
        };
      });
      return { prev };
    },
    onError: (err, _, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error(err.response?.data?.detail ?? 'Cannot move to this stage');
    },
    onSuccess: () => setPendingDrop(null),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['hr-applications'] }),
  });

  function handleDragStart({ active }) {
    const app = applications.find((a) => a.id === active.id);
    setActiveApp(app ?? null);
  }

  function handleDragEnd({ active, over }) {
    setActiveApp(null);
    if (!over) return;
    const toStage = over.id;
    const app = applications.find((a) => a.id === active.id);
    if (!app || app.stage === toStage) return;
    if (app.on_hold) {
      toast.error('This candidate is on hold — resume before changing stage.');
      return;
    }
    if (REASON_REQUIRED_STAGES.has(toStage)) {
      setPendingDrop({ app, toStage });
    } else {
      stageMutation.mutate({ id: app.id, stage: toStage });
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {PIPELINE_STAGES.map(({ key, label, color }) => (
          <KanbanColumn
            key={key}
            stageKey={key}
            label={label}
            colorClass={color}
            cards={grouped[key] ?? []}
            onCardClick={onCardClick}
            onToggleHold={onToggleHold}
          />
        ))}
      </div>

      <DragOverlay>
        {activeApp && (
          <div className="w-56 opacity-90 rotate-1 shadow-xl">
            <KanbanCard application={activeApp} onClick={() => {}} />
          </div>
        )}
      </DragOverlay>

      {pendingDrop && (
        <StageReasonDialog
          stage={pendingDrop.toStage}
          candidateName={pendingDrop.app.applicant?.full_name ?? 'this candidate'}
          interviews={[]}
          isPending={stageMutation.isPending}
          onCancel={() => setPendingDrop(null)}
          onConfirm={({ category, note }) =>
            stageMutation.mutate({
              id: pendingDrop.app.id,
              stage: pendingDrop.toStage,
              rejection_reason: note,
              drop_category: category,
            })
          }
        />
      )}
    </DndContext>
  );
}

// ── Table View ────────────────────────────────────────────────────────────────

function TableView({ applications, onRowClick, onToggleHold }) {
  return (
    <div className="bg-white rounded-xl border border-surface-200 overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="bg-surface-50 border-b border-surface-100">
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-5 py-3">
              Candidate
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">
              Stage
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">
              Source
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">
              Rating
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">
              Applied
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-50">
          {applications.map((app) => {
            const stage = STAGE_MAP[app.stage];
            const name = app.applicant?.full_name ?? 'Unknown';
            return (
              <tr
                key={app.id}
                onClick={() => onRowClick(app.id)}
                className="hover:bg-surface-50 cursor-pointer transition-colors"
              >
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-brand-700">
                      {initials(name)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 flex items-center gap-1.5">
                        {name}
                        {app.duplicate_flag && !app.duplicate_reviewed_at && (
                          <AlertTriangle className="w-3 h-3 text-amber-500" title="Possible duplicate candidate" />
                        )}
                        {app.is_starred && (
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                        )}
                      </p>
                      <p className="text-xs text-gray-400">{app.applicant?.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stage?.color ?? 'bg-gray-100 text-gray-600'}`}>
                      {stage?.label ?? app.stage}
                    </span>
                    {app.on_hold && (
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                        title={app.hold_reason ?? undefined}
                      >
                        On Hold
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3.5 text-gray-500">
                  {app.source === 'agency'
                    ? (app.agency_name || 'Agency')
                    : <span className="capitalize">{app.source}</span>}
                </td>
                <td className="px-4 py-3.5">
                  {app.rating ? (
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3 h-3 ${
                            i < app.rating
                              ? 'text-yellow-400 fill-yellow-400'
                              : 'text-gray-200'
                          }`}
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-xs text-gray-400">
                  {formatDistanceToNow(new Date(app.applied_at), { addSuffix: true })}
                </td>
                <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onToggleHold(app)}
                    className={`p-1 rounded transition-colors ${
                      app.on_hold ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-gray-500'
                    }`}
                    title={
                      app.on_hold
                        ? `On hold${app.hold_reason ? `: ${app.hold_reason}` : ''} — click to resume`
                        : 'Put on hold'
                    }
                  >
                    <Pause className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Add Candidate (Talent Acquisition sourcing) ──────────────────────────────

const SOURCE_OPTIONS = [
  { value: 'talent_acquisition', label: 'Talent Acquisition' },
  { value: 'direct', label: 'Direct' },
];

function AddCandidateModal({ jobs, onClose }) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState('');
  const [source, setSource] = useState('talent_acquisition');

  const handleSubmit = async (payload) => {
    if (!jobId) {
      toast.error('Please select a job');
      throw new Error('no job');
    }
    try {
      await applicationsApi.hrSubmitCandidate({ ...payload, job_id: jobId, source });
      toast.success('Candidate added to the pipeline!');
      queryClient.invalidateQueries({ queryKey: ['hr-applications'] });
      onClose();
    } catch (err) {
      if (err.response) toast.error(err.response.data?.detail ?? 'Failed to add candidate');
      throw err;
    }
  };

  const selectCls =
    'w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg my-8 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">Add candidate</h3>
            <p className="text-xs text-gray-500 mt-0.5">Upload a sourced resume — fields auto-fill for review</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <CandidateIntakeForm
          onParse={(file) => uploadsApi.parseResume(file)}
          onSubmit={handleSubmit}
          submitLabel="Add candidate"
          disabled={!jobId}
          header={
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Job <span className="text-red-500">*</span>
                </label>
                <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={selectCls}>
                  <option value="">Select a job…</option>
                  {jobs?.map((job) => (
                    <option key={job.id} value={job.id}>{job.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Source</label>
                <select value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
                  {SOURCE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ApplicantsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [view, setView] = useState('kanban');
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data: agenciesData } = useQuery({
    queryKey: ['agencies'],
    queryFn: () => agenciesApi.list().then((r) => r.data),
  });

  const { data: jobsData } = useQuery({
    queryKey: ['hr-jobs-list'],
    queryFn: () => jobsApi.list({ limit: 100 }).then((r) => r.data.items),
  });

  const queryParams = {
    jobId: selectedJobId,
    stage: view === 'kanban' ? '' : stageFilter,
    agencyId: agencyFilter,
    search,
    page: view === 'kanban' ? 1 : page,
  };

  const queryKey = ['hr-applications', queryParams];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      applicationsApi
        .list({
          job_id: selectedJobId || undefined,
          stage: view === 'kanban' ? undefined : stageFilter || undefined,
          agency_id: agencyFilter || undefined,
          search: search || undefined,
          page: view === 'kanban' ? 1 : page,
          limit: view === 'kanban' ? 200 : 20,
        })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const applications = data?.items ?? [];

  const { pendingHold, setPendingHold, holdMutation, toggleHold } = useHoldToggle(queryKey);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900">Applicants</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data?.total ?? 0} total applicants
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowAddCandidate(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add candidate
          </button>
          <button
            onClick={() => setShowBulkUpload(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-surface-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-surface-50 transition-colors"
          >
            <UploadCloud className="w-4 h-4" />
            Bulk upload
          </button>
          {/* The two view toggles are one control — keep them on the same line
              when the row wraps on narrow screens. */}
          <div className="flex items-center gap-2 ml-auto sm:ml-0">
            <button
              onClick={() => setView('kanban')}
              className={`p-2 rounded-lg transition-colors ${
                view === 'kanban'
                  ? 'bg-brand-500 text-white'
                  : 'bg-white border border-surface-200 text-gray-500 hover:text-gray-700'
              }`}
              title="Kanban view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView('table')}
              className={`p-2 rounded-lg transition-colors ${
                view === 'table'
                  ? 'bg-brand-500 text-white'
                  : 'bg-white border border-surface-200 text-gray-500 hover:text-gray-700'
              }`}
              title="Table view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Job selector */}
        <select
          value={selectedJobId}
          onChange={(e) => { setSelectedJobId(e.target.value); setPage(1); }}
          className="text-sm border border-surface-300 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 max-w-full min-w-0 flex-1 sm:flex-none"
        >
          <option value="">All jobs</option>
          {jobsData?.map((job) => (
            <option key={job.id} value={job.id}>{job.title}</option>
          ))}
        </select>

        {/* Stage filter (table only) */}
        {view === 'table' && (
          <select
            value={stageFilter}
            onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
            className="text-sm border border-surface-300 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 max-w-full min-w-0 flex-1 sm:flex-none"
          >
            <option value="">All stages</option>
            {PIPELINE_STAGES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        )}

        {/* Agency filter */}
        {agenciesData?.length > 0 && (
          <select
            value={agencyFilter}
            onChange={(e) => { setAgencyFilter(e.target.value); setPage(1); }}
            className="text-sm border border-surface-300 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 max-w-full min-w-0 flex-1 sm:flex-none"
          >
            <option value="">All sources</option>
            {agenciesData.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}

        {/* Search */}
        <div className="relative w-full sm:w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 pr-8 py-2 border border-surface-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-full"
          />
          {search && (
            <button
              onClick={() => { setSearch(''); setPage(1); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-5 bg-surface-100 rounded animate-pulse w-20" />
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="h-20 bg-surface-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      ) : applications.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-sm">No applicants found</p>
        </div>
      ) : view === 'kanban' ? (
        <KanbanView
          applications={applications}
          queryKey={queryKey}
          onCardClick={(id) => navigate(`/hr/applicants/${id}`)}
          onToggleHold={toggleHold}
        />
      ) : (
        <>
          <TableView
            applications={applications}
            onRowClick={(id) => navigate(`/hr/applicants/${id}`)}
            onToggleHold={toggleHold}
          />
          {data && data.pages > 1 && (
            <div className="flex items-center justify-end gap-3 mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500">{page} / {data.pages}</span>
              <button
                onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                disabled={page === data.pages}
                className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {showAddCandidate && (
        <AddCandidateModal jobs={jobsData} onClose={() => setShowAddCandidate(false)} />
      )}
      {showBulkUpload && (
        <BulkUploadModal jobs={jobsData} onClose={() => setShowBulkUpload(false)} />
      )}

      {pendingHold && (
        <HoldReasonDialog
          candidateName={pendingHold.applicant?.full_name ?? 'this candidate'}
          isPending={holdMutation.isPending}
          onCancel={() => setPendingHold(null)}
          onConfirm={(reason) =>
            holdMutation.mutate({ id: pendingHold.id, on_hold: true, hold_reason: reason })
          }
        />
      )}
    </div>
  );
}
