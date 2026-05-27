import React, { useState, useEffect, useCallback } from 'react';
import {
  getCheckpoints,
  getPendingCheckpoints,
  resolveCheckpoint,
  HITLCheckpoint,
} from '../api/mcp';

const STATUS_COLOR: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444',
  timeout: '#6b7280',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border border-amber-300',
  approved: 'bg-green-100 text-green-800 border border-green-300',
  rejected: 'bg-red-100 text-red-800 border border-red-300',
  timeout: 'bg-gray-100 text-gray-600 border border-gray-300',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function expiresIn(iso?: string) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  return `${Math.floor(diff / 3600000)}h`;
}

interface ResolveModalProps {
  checkpoint: HITLCheckpoint;
  onClose: () => void;
  onResolved: () => void;
}

function ResolveModal({ checkpoint, onClose, onResolved }: ResolveModalProps) {
  const [action, setAction] = useState<'approved' | 'rejected'>('approved');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await resolveCheckpoint(checkpoint.id, action, feedback || undefined);
      onResolved();
    } catch (e: any) {
      setError(e?.message || 'Failed to resolve checkpoint');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Review Checkpoint</h2>
            <p className="text-sm text-gray-500 mt-0.5">{checkpoint.agent_name} · {checkpoint.node_id}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">×</button>
        </div>

        {/* Context */}
        <div className="px-6 py-4 space-y-4">
          {/* Prompt */}
          {checkpoint.prompt && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Agent Prompt</p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900 max-h-32 overflow-y-auto">
                {checkpoint.prompt}
              </div>
            </div>
          )}

          {/* Context Snapshot */}
          {checkpoint.context_snapshot && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Context Snapshot</p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono text-gray-700 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {typeof checkpoint.context_snapshot === 'string'
                  ? checkpoint.context_snapshot
                  : JSON.stringify(checkpoint.context_snapshot, null, 2)}
              </div>
            </div>
          )}

          {/* Run info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-0.5">Run ID</p>
              <p className="font-mono text-gray-800 truncate">{checkpoint.run_id}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-0.5">Created</p>
              <p className="text-gray-800">{timeAgo(checkpoint.created_at)}</p>
            </div>
          </div>

          {/* Decision */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Decision</p>
            <div className="flex gap-3">
              <button
                onClick={() => setAction('approved')}
                className={`flex-1 py-2.5 rounded-lg border-2 font-medium text-sm transition-all ${
                  action === 'approved'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 text-gray-500 hover:border-green-300'
                }`}
              >
                ✓ Approve
              </button>
              <button
                onClick={() => setAction('rejected')}
                className={`flex-1 py-2.5 rounded-lg border-2 font-medium text-sm transition-all ${
                  action === 'rejected'
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-gray-200 text-gray-500 hover:border-red-300'
                }`}
              >
                ✕ Reject
              </button>
            </div>
          </div>

          {/* Feedback */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
              Feedback <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Add instructions or reasoning for the agent..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={`px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${
              action === 'approved'
                ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-300'
                : 'bg-red-600 hover:bg-red-700 disabled:bg-red-300'
            }`}
          >
            {submitting ? 'Submitting…' : action === 'approved' ? 'Approve & Continue' : 'Reject & Stop'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CheckpointRowProps {
  checkpoint: HITLCheckpoint;
  onReview: (cp: HITLCheckpoint) => void;
}

function CheckpointRow({ checkpoint, onReview }: CheckpointRowProps) {
  const [expanded, setExpanded] = useState(false);
  const exp = expiresIn(checkpoint.expires_at);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white hover:shadow-md transition-shadow">
      <div
        className="flex items-start gap-4 px-5 py-4 cursor-pointer"
        onClick={() => setExpanded(x => !x)}
      >
        {/* Status dot */}
        <div className="mt-1 flex-shrink-0">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: STATUS_COLOR[checkpoint.status] || '#9ca3af' }}
          />
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{checkpoint.agent_name}</span>
            <span className="text-gray-400">·</span>
            <span className="text-sm text-gray-600 font-mono">{checkpoint.node_id}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[checkpoint.status]}`}>
              {checkpoint.status}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5 truncate">
            Run: <span className="font-mono">{checkpoint.run_id.slice(0, 16)}…</span>
            {' · '}
            {timeAgo(checkpoint.created_at)}
            {exp && checkpoint.status === 'pending' && (
              <span className={`ml-2 text-xs font-medium ${exp === 'Expired' ? 'text-red-500' : 'text-amber-600'}`}>
                ⏱ {exp === 'Expired' ? 'Expired' : `Expires in ${exp}`}
              </span>
            )}
          </p>
          {checkpoint.prompt && (
            <p className="text-sm text-gray-600 mt-1 line-clamp-1">{checkpoint.prompt}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {checkpoint.status === 'pending' && (
            <button
              onClick={() => onReview(checkpoint)}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Review
            </button>
          )}
          <button
            className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1"
            onClick={() => setExpanded(x => !x)}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Workflow</p>
              <p className="font-mono text-gray-700 truncate">{checkpoint.workflow_id || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Agent ID</p>
              <p className="font-mono text-gray-700 truncate">{checkpoint.agent_id}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Reviewer</p>
              <p className="text-gray-700">{checkpoint.reviewer || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Resolved At</p>
              <p className="text-gray-700">{checkpoint.resolved_at ? timeAgo(checkpoint.resolved_at) : '—'}</p>
            </div>
          </div>

          {checkpoint.feedback && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Feedback</p>
              <p className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2">
                {checkpoint.feedback}
              </p>
            </div>
          )}

          {checkpoint.context_snapshot && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Context Snapshot</p>
              <pre className="text-xs font-mono bg-gray-900 text-green-300 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {typeof checkpoint.context_snapshot === 'string'
                  ? checkpoint.context_snapshot
                  : JSON.stringify(checkpoint.context_snapshot, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HITLPage() {
  const [checkpoints, setCheckpoints] = useState<HITLCheckpoint[]>([]);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [resolveTarget, setResolveTarget] = useState<HITLCheckpoint | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [cps, pids] = await Promise.all([
        getCheckpoints(statusFilter === 'all' ? undefined : statusFilter),
        getPendingCheckpoints(),
      ]);
      setCheckpoints(cps);
      setPendingIds(pids);
      setLastRefresh(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Failed to load checkpoints');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Auto-refresh every 10s when there are pending items
  useEffect(() => {
    if (pendingIds.length === 0) return;
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [pendingIds.length, load]);

  const handleResolved = () => {
    setResolveTarget(null);
    load();
  };

  const pending = checkpoints.filter(c => c.status === 'pending');
  const approved = checkpoints.filter(c => c.status === 'approved');
  const rejected = checkpoints.filter(c => c.status === 'rejected');
  const timedOut = checkpoints.filter(c => c.status === 'timeout');

  return (
    <div className="min-h-screen bg-gray-50">
      {resolveTarget && (
        <ResolveModal
          checkpoint={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={handleResolved}
        />
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Human-in-the-Loop</h1>
            <p className="text-sm text-gray-500 mt-0.5">Review and approve agent workflow checkpoints</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">
              Refreshed {Math.round((Date.now() - lastRefresh) / 1000)}s ago
            </span>
            <button
              onClick={() => { setLoading(true); load(); }}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? '↻ Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Pending Review', count: pending.length, color: 'amber', icon: '⏳' },
            { label: 'Approved', count: approved.length, color: 'green', icon: '✓' },
            { label: 'Rejected', count: rejected.length, color: 'red', icon: '✕' },
            { label: 'Timed Out', count: timedOut.length, color: 'gray', icon: '⏱' },
          ].map(({ label, count, color, icon }) => (
            <div
              key={label}
              className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${
                statusFilter === label.toLowerCase().replace(' ', '_')
                  ? 'ring-2 ring-blue-500'
                  : 'hover:shadow-md border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">{icon}</span>
                <span className={`text-2xl font-bold text-${color}-600`}>{count}</span>
              </div>
              <p className="text-sm text-gray-600 mt-1 font-medium">{label}</p>
            </div>
          ))}
        </div>

        {/* Pending alert */}
        {pendingIds.length > 0 && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-300 rounded-xl px-5 py-3">
            <span className="text-amber-500 text-xl">🔔</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">
                {pendingIds.length} checkpoint{pendingIds.length > 1 ? 's' : ''} waiting for review
              </p>
              <p className="text-xs text-amber-600">Workflows are paused until you approve or reject.</p>
            </div>
            <button
              onClick={() => setStatusFilter('pending')}
              className="text-sm font-medium text-amber-700 underline hover:text-amber-900"
            >
              Show pending
            </button>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 bg-white border border-gray-200 rounded-xl p-1 w-fit">
          {['all', 'pending', 'approved', 'rejected', 'timeout'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${
                statusFilter === s
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {s === 'all' ? `All (${checkpoints.length})` : s}
            </button>
          ))}
        </div>

        {/* List */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">{error}</div>
        )}

        {loading && checkpoints.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-gray-400">
            <div className="text-center space-y-3">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm">Loading checkpoints…</p>
            </div>
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-gray-400">
            <div className="text-center space-y-3">
              <div className="text-5xl">✅</div>
              <p className="text-lg font-medium text-gray-600">No checkpoints</p>
              <p className="text-sm">
                {statusFilter === 'all'
                  ? 'No HITL breakpoints have been triggered yet.'
                  : `No ${statusFilter} checkpoints found.`}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {checkpoints.map(cp => (
              <CheckpointRow key={cp.id} checkpoint={cp} onReview={setResolveTarget} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
