'use client';

import React, { useEffect, useState, useCallback, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import {
  adminTopicsApi,
  type TopicNode,
  type CreateTopicInput,
} from '@web/lib/admin-topics-api';
import { adminMediaApi, type Media } from '@web/lib/admin-media-api';
import { MediaUploader } from '@web/components/admin/MediaUploader';
import { MediaList } from '@web/components/admin/MediaList';
import { Spinner } from '@web/components/spinner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TreeNode = TopicNode & { children: TreeNode[] };
type DropPosition = 'before' | 'child' | 'after';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTree(nodes: TopicNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(
    nodes.map((n) => [n.id, { ...n, children: [] }]),
  );
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      const parent = byId.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  function sortChildren(list: TreeNode[]): void {
    list.sort((a, b) => a.order - b.order);
    for (const n of list) sortChildren(n.children);
  }
  sortChildren(roots);
  return roots;
}

function getDropPosition(e: React.DragEvent<HTMLElement>): DropPosition {
  const rect = e.currentTarget.getBoundingClientRect();
  const height = rect.height || 1;
  // Use a fallback for clientY to handle environments where it might be in different places
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientY = e.clientY ?? (e as any).nativeEvent?.clientY ?? 0;
  const ratio = (clientY - rect.top) / height;
  if (ratio < 0.35) return 'before';
  if (ratio > 0.65) return 'after';
  return 'child';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700',
  published: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-500/20',
  archived: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-500/20',
};

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------

type CreateModalProps = {
  parentId: string | null;
  onSubmit: (data: CreateTopicInput) => Promise<void>;
  onClose: () => void;
};

function CreateModal({ parentId, onSubmit, onClose }: CreateModalProps) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    setSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), parentId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={parentId ? 'Add child topic' : 'New root topic'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {parentId ? 'Add child topic' : 'New root topic'}
        </h2>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="cm-title" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Title
            </label>
            <input
              id="cm-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              autoFocus
            />
          </div>

          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting && <Spinner className="h-4 w-4" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm action"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
        <p className="mb-4 text-sm text-zinc-700 dark:text-zinc-300">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminTopicsPage() {
  const router = useRouter();
  const { accessToken, isLoading: authLoading } = useAuth();
  const canAccess = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);

  // ---------------------------------------------------------------------------
  // Core state
  // ---------------------------------------------------------------------------

  const [nodes, setNodes] = useState<TopicNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Inline title editing
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineTitle, setInlineTitle] = useState('');

  // Create
  const [showCreate, setShowCreate] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);

  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState<TopicNode | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; kind: 'error' | 'success' } | null>(null);

  // Drag and drop
  const draggingIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);

  // Detail pane
  const [detailTitle, setDetailTitle] = useState('');
  const [detailContent, setDetailContent] = useState('');
  const [detailStatus, setDetailStatus] = useState<'draft' | 'published' | 'archived'>('draft');
  const [detailMinutes, setDetailMinutes] = useState(0);
  const [detailTagIds, setDetailTagIds] = useState('');
  const [detailPrereqIds, setDetailPrereqIds] = useState('');
  const [detailError, setDetailError] = useState('');
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailMedia, setDetailMedia] = useState<Media[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  // ---------------------------------------------------------------------------
  // RBAC guard
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!authLoading && !canAccess) {
      router.replace('/dashboard');
    }
  }, [authLoading, canAccess, router]);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setFetchError('');
    try {
      const data = await adminTopicsApi.list(accessToken);
      setNodes(data);
    } catch {
      setFetchError('Failed to load topics.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (canAccess && accessToken) refresh();
  }, [canAccess, accessToken, refresh]);

  // ---------------------------------------------------------------------------
  // Sync detail pane when selected node changes
  // ---------------------------------------------------------------------------

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedNode) {
      setDetailTitle('');
      setDetailContent('');
      setDetailStatus('draft');
      setDetailMinutes(0);
      setDetailTagIds('');
      setDetailPrereqIds('');
      setDetailMedia([]);
      return;
    }
    setDetailTitle(selectedNode.title);
    setDetailContent(selectedNode.content);
    setDetailStatus(selectedNode.status);
    setDetailMinutes(selectedNode.estimatedMinutes);
    setDetailTagIds(selectedNode.tags.map((t) => t.id).join(', '));
    setDetailPrereqIds(selectedNode.prerequisiteIds.join(', '));
    
    // Load media
    if (accessToken) {
      setLoadingMedia(true);
      adminMediaApi.list(accessToken, selectedNode.id)
        .then(setDetailMedia)
        .catch(() => showToast('Failed to load media', 'error'))
        .finally(() => setLoadingMedia(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, accessToken]);

  // ---------------------------------------------------------------------------
  // Toast helpers
  // ---------------------------------------------------------------------------

  function showToast(message: string, kind: 'error' | 'success') {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 4000);
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleInlineSave(id: string, title: string) {
    if (!title.trim() || !accessToken) { setInlineEditId(null); return; }
    try {
      await adminTopicsApi.update(accessToken, id, { title: title.trim() });
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to rename topic', 'error');
    } finally {
      setInlineEditId(null);
    }
  }

  async function handleCreate(data: CreateTopicInput) {
    if (!accessToken) return;
    await adminTopicsApi.create(accessToken, data);
    await refresh();
    showToast('Topic created', 'success');
  }

  async function handleArchive() {
    if (!archiveTarget || !accessToken) return;
    try {
      await adminTopicsApi.archive(accessToken, archiveTarget.id);
      setArchiveTarget(null);
      if (selectedId === archiveTarget.id) setSelectedId(null);
      await refresh();
      showToast('Topic archived', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to archive topic', 'error');
      setArchiveTarget(null);
    }
  }

  async function handleDetailSave(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !accessToken) return;
    setDetailError('');
    setDetailSaving(true);
    try {
      const tagIds = detailTagIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const prereqIds = detailPrereqIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await adminTopicsApi.update(accessToken, selectedId, {
        title: detailTitle,
        content: detailContent,
        status: detailStatus,
        estimatedMinutes: detailMinutes,
        tagIds,
        prerequisiteIds: prereqIds,
      });
      await refresh();
      showToast('Changes saved', 'success');
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setDetailSaving(false);
    }
  }

  async function reloadMedia() {
    if (!accessToken || !selectedId) return;
    setLoadingMedia(true);
    try {
      const media = await adminMediaApi.list(accessToken, selectedId);
      setDetailMedia(media);
    } catch {
      showToast('Failed to reload media', 'error');
    } finally {
      setLoadingMedia(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Drag and drop handlers
  // ---------------------------------------------------------------------------

  function handleDragStart(nodeId: string) {
    return (e: React.DragEvent) => {
      draggingIdRef.current = nodeId;
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    };
  }

  function handleDragOver(node: TopicNode) {
    return (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const position = getDropPosition(e);
      setDropTarget({ id: node.id, position });
    };
  }

  function handleDragLeave() {
    setDropTarget(null);
  }

  function handleDragEnd() {
    draggingIdRef.current = null;
    setDropTarget(null);
  }

  function handleDrop(targetNode: TopicNode) {
    return async (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      const sourceId = draggingIdRef.current;
      draggingIdRef.current = null;
      const position = getDropPosition(e);
      setDropTarget(null);

      if (!sourceId || sourceId === targetNode.id || !accessToken) return;

      try {
        let moveArgs: { newParentId: string | null; newSortOrder?: number };
        if (position === 'child') {
          moveArgs = { newParentId: targetNode.id };
        } else if (position === 'before') {
          moveArgs = { newParentId: targetNode.parentId, newSortOrder: targetNode.order };
        } else {
          moveArgs = { newParentId: targetNode.parentId, newSortOrder: targetNode.order + 1 };
        }
        await adminTopicsApi.move(accessToken, sourceId, moveArgs);
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Move failed';
        showToast(
          msg === 'WOULD_CYCLE' ? 'Cannot move: operation would create a circular dependency' : msg,
          'error',
        );
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Tree rendering
  // ---------------------------------------------------------------------------

  function renderNodes(treeNodes: TreeNode[], depth = 0): React.ReactNode {
    return treeNodes.map((node) => {
      const isSelected = selectedId === node.id;
      const isExpanded = expandedIds.has(node.id);
      const isInlineEdit = inlineEditId === node.id;
      const isDropTarget = dropTarget?.id === node.id;

      let dropIndicatorClass = '';
      if (isDropTarget) {
        if (dropTarget.position === 'child') dropIndicatorClass = 'ring-2 ring-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/10';
        else if (dropTarget.position === 'before') dropIndicatorClass = 'before:absolute before:-top-px before:left-0 before:right-0 before:h-0.5 before:bg-indigo-500 before:z-10 relative';
        else dropIndicatorClass = 'after:absolute after:-bottom-px after:left-0 after:right-0 after:h-0.5 after:bg-indigo-500 after:z-10 relative';
      }

      return (
        <div key={node.id}>
          <div
            className={`group flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm transition-all duration-200 ${
              isSelected
                ? 'bg-indigo-50 text-indigo-900 shadow-sm dark:bg-indigo-500/10 dark:text-indigo-300'
                : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50'
            } ${node.archived ? 'opacity-40 grayscale-[0.5]' : ''} ${dropIndicatorClass}`}
            style={{ paddingLeft: `${6 + depth * 18}px` }}
            data-testid={`topic-node-${node.id}`}
            onClick={() => setSelectedId(node.id)}
            onDragOver={handleDragOver(node)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop(node)}
          >
            {/* Expand / collapse toggle */}
            <button
              type="button"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
              onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
              className="w-4 flex-shrink-0 text-center text-xs text-zinc-400 disabled:invisible"
              disabled={node.children.length === 0}
            >
              {node.children.length > 0 ? (isExpanded ? '▾' : '▸') : ''}
            </button>

            {/* Drag handle */}
            <span
              draggable
              onDragStart={handleDragStart(node.id)}
              onDragEnd={handleDragEnd}
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0 cursor-grab text-zinc-300 transition-colors group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-400 select-none active:cursor-grabbing"
              data-testid={`drag-handle-${node.id}`}
              aria-label="Drag to reorder"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
              </svg>
            </span>

            {/* Title — inline edit or text */}
            {isInlineEdit ? (
              <input
                ref={(el) => { if (el) el.focus(); }}
                value={inlineTitle}
                onChange={(e) => setInlineTitle(e.target.value)}
                onBlur={() => handleInlineSave(node.id, inlineTitle)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleInlineSave(node.id, inlineTitle); }
                  if (e.key === 'Escape') setInlineEditId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded border border-indigo-300 px-1 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                data-testid={`inline-edit-${node.id}`}
              />
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setInlineEditId(node.id);
                  setInlineTitle(node.title);
                }}
                className="min-w-0 flex-1 truncate text-left font-medium text-zinc-900 hover:text-indigo-700 dark:text-zinc-100 dark:hover:text-indigo-300"
                data-testid={`title-btn-${node.id}`}
              >
                {node.title}
              </button>
            )}

            {/* Status badge */}
            <span
              className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[node.status] ?? ''}`}
            >
              {node.status}
            </span>

            {/* Add child */}
            <button
              type="button"
              aria-label={`Add child to ${node.title}`}
              onClick={(e) => {
                e.stopPropagation();
                setCreateParentId(node.id);
                setShowCreate(true);
              }}
              className="flex-shrink-0 text-xs text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              + Child
            </button>

            {/* Archive */}
            <button
              type="button"
              aria-label={`Archive ${node.title}`}
              onClick={(e) => { e.stopPropagation(); setArchiveTarget(node); }}
              className="flex-shrink-0 text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
            >
              Archive
            </button>
          </div>

          {/* Children (if expanded) */}
          {isExpanded && node.children.length > 0 && renderNodes(node.children, depth + 1)}
        </div>
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Guard rendering
  // ---------------------------------------------------------------------------

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-600" />
      </div>
    );
  }

  if (!canAccess) return null;

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  const tree = buildTree(nodes);

  return (
    <main className="flex h-[calc(100vh-57px)] flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200/80 bg-white/50 px-6 py-4 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-900/50">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Topic Tree</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Build and organize your educational hierarchy</p>
        </div>
        <button
          onClick={() => { setCreateParentId(null); setShowCreate(true); }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-indigo-500/25 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
        >
          New Root Topic
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: tree panel */}
        <div className="w-80 flex-shrink-0 overflow-y-auto border-r border-zinc-200/80 bg-white/30 backdrop-blur-sm p-4 dark:border-zinc-800/80 dark:bg-zinc-900/10">
          {fetchError && (
            <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">{fetchError}</p>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-zinc-400" />
            </div>
          ) : tree.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">
              No topics yet. Create your first root topic.
            </p>
          ) : (
            <div>{renderNodes(tree)}</div>
          )}
        </div>

        {/* Right: detail pane */}
        <div className="flex-1 overflow-y-auto p-8">
          {!selectedNode ? (
            <div className="flex h-full flex-col items-center justify-center space-y-4 opacity-40">
              <div className="rounded-full bg-zinc-100 p-6 dark:bg-zinc-800">
                <svg className="h-12 w-12 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-zinc-500">Select a topic to edit its details</p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                    {detailTitle || 'Untitled Topic'}
                  </h2>
                  <p className="text-sm text-zinc-500">Topic ID: <code className="font-mono text-xs">{selectedId}</code></p>
                </div>
                <div className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${STATUS_COLORS[detailStatus]}`}>
                  {detailStatus}
                </div>
              </div>

              <form onSubmit={handleDetailSave} className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50" noValidate>

              <div>
                <label htmlFor="dp-title" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Title
                </label>
                <input
                  id="dp-title"
                  type="text"
                  value={detailTitle}
                  onChange={(e) => setDetailTitle(e.target.value)}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                />
              </div>

              <div>
                <label htmlFor="dp-status" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Status
                </label>
                <select
                  id="dp-status"
                  value={detailStatus}
                  onChange={(e) => setDetailStatus(e.target.value as typeof detailStatus)}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </div>

              <div>
                <label htmlFor="dp-content" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Content (Markdown)
                </label>
                <textarea
                  id="dp-content"
                  value={detailContent}
                  onChange={(e) => setDetailContent(e.target.value)}
                  rows={8}
                  className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                />
              </div>

              <div>
                <label htmlFor="dp-minutes" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Estimated Minutes
                </label>
                <input
                  id="dp-minutes"
                  type="number"
                  min={0}
                  value={detailMinutes}
                  onChange={(e) => setDetailMinutes(Number(e.target.value))}
                  className="w-40 rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                />
              </div>

              <div>
                <label htmlFor="dp-tags" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Tag IDs <span className="font-normal text-zinc-400">(comma-separated)</span>
                </label>
                <input
                  id="dp-tags"
                  type="text"
                  value={detailTagIds}
                  onChange={(e) => setDetailTagIds(e.target.value)}
                  placeholder="tag-id-1, tag-id-2"
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                />
              </div>

              <div>
                <label htmlFor="dp-prereqs" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Prerequisite IDs <span className="font-normal text-zinc-400">(comma-separated)</span>
                </label>
                <input
                  id="dp-prereqs"
                  type="text"
                  value={detailPrereqIds}
                  onChange={(e) => setDetailPrereqIds(e.target.value)}
                  placeholder="node-id-1, node-id-2"
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                />
              </div>

              {detailError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{detailError}</p>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={detailSaving}
                  className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {detailSaving && <Spinner className="h-4 w-4" />}
                  Save changes
                </button>
              </div>
            </form>

            <div className="mt-12 space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Media Attachments</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Upload and manage files associated with this topic.</p>
              </div>

              {accessToken && selectedId && (
                <MediaUploader
                  topicId={selectedId}
                  token={accessToken}
                  onUploadComplete={reloadMedia}
                />
              )}

              {loadingMedia ? (
                <div className="flex justify-center py-8">
                  <Spinner className="h-6 w-6 text-zinc-400" />
                </div>
              ) : (
                accessToken && selectedId && (
                  <MediaList
                    topicId={selectedId}
                    token={accessToken}
                    media={detailMedia}
                    onMediaDeleted={reloadMedia}
                  />
                )
              )}
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateModal
          parentId={createParentId}
          onSubmit={handleCreate}
          onClose={() => { setShowCreate(false); setCreateParentId(null); }}
        />
      )}

      {archiveTarget && (
        <ConfirmDialog
          message={`Archive "${archiveTarget.title}"? This will also archive all its descendants.`}
          onConfirm={handleArchive}
          onCancel={() => setArchiveTarget(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.kind === 'error'
              ? 'bg-red-600 text-white'
              : 'bg-green-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </main>
  );
}
