import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, closestCorners,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { formatDistanceToNow } from 'date-fns';
import { Search, LayoutGrid, List, Star, GripVertical, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { applicationsApi } from '@/api/applications';
import { jobsApi } from '@/api/jobs';

const PIPELINE_STAGES = [
  { key: 'applied',    label: 'Applied',    color: 'bg-blue-100 text-blue-800' },
  { key: 'screening',  label: 'Screening',  color: 'bg-purple-100 text-purple-800' },
  { key: 'assessment', label: 'Assessment', color: 'bg-orange-100 text-orange-800' },
  { key: 'tr1',        label: 'TR1',        color: 'bg-indigo-100 text-indigo-800' },
  { key: 'tr2',        label: 'TR2',        color: 'bg-indigo-100 text-indigo-800' },
  { key: 'hr',         label: 'HR',         color: 'bg-violet-100 text-violet-800' },
  { key: 'offer',      label: 'Offer',      color: 'bg-emerald-100 text-emerald-800' },
  { key: 'hired',      label: 'Hired',      color: 'bg-green-100 text-green-800' },
  { key: 'rejected',   label: 'Rejected',   color: 'bg-red-100 text-red-800' },
];

const STAGE_MAP = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s]));

function initials(name) {
  return (name ?? '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ── Kanban Card ──────────────────────────────────────────────────────────────

function KanbanCard({ application, onClick }) {
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
      className={`bg-white rounded-lg border border-surface-200 p-3 hover:border-brand-300 hover:shadow-sm transition-all ${
        isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-pointer'
      }`}
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
        {application.is_starred && (
          <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400 flex-shrink-0" />
        )}
      </div>
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

function KanbanColumn({ stageKey, label, colorClass, cards, onCardClick }) {
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
          <KanbanCard key={app.id} application={app} onClick={onCardClick} />
        ))}
      </div>
    </div>
  );
}

// ── Kanban View ───────────────────────────────────────────────────────────────

function KanbanView({ applications, queryKey, onCardClick }) {
  const queryClient = useQueryClient();
  const [activeApp, setActiveApp] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
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
    mutationFn: ({ id, stage }) => applicationsApi.moveStage(id, stage),
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
    stageMutation.mutate({ id: app.id, stage: toStage });
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
    </DndContext>
  );
}

// ── Table View ────────────────────────────────────────────────────────────────

function TableView({ applications, onRowClick }) {
  return (
    <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
      <table className="w-full text-sm">
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
                        {app.is_starred && (
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                        )}
                      </p>
                      <p className="text-xs text-gray-400">{app.applicant?.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stage?.color ?? 'bg-gray-100 text-gray-600'}`}>
                    {stage?.label ?? app.stage}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-gray-500 capitalize">{app.source}</td>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ApplicantsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [view, setView] = useState('kanban');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data: jobsData } = useQuery({
    queryKey: ['hr-jobs-list'],
    queryFn: () => jobsApi.list({ limit: 100 }).then((r) => r.data.items),
  });

  const queryParams = {
    jobId: selectedJobId,
    stage: view === 'kanban' ? '' : stageFilter,
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
          search: search || undefined,
          page: view === 'kanban' ? 1 : page,
          limit: view === 'kanban' ? 200 : 20,
        })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const applications = data?.items ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900">Applicants</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data?.total ?? 0} total applicants
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Job selector */}
        <select
          value={selectedJobId}
          onChange={(e) => { setSelectedJobId(e.target.value); setPage(1); }}
          className="text-sm border border-surface-300 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
            className="text-sm border border-surface-300 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All stages</option>
            {PIPELINE_STAGES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 pr-8 py-2 border border-surface-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-52"
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
        <div className="grid grid-cols-5 gap-3">
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
        />
      ) : (
        <>
          <TableView
            applications={applications}
            onRowClick={(id) => navigate(`/hr/applicants/${id}`)}
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
    </div>
  );
}
