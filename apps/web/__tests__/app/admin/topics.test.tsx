import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TopicNode } from '@web/lib/admin-topics-api';

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

// ---------------------------------------------------------------------------
// Mock useAuth / useHasRole
// ---------------------------------------------------------------------------

const mockUseAuth = vi.fn();
const mockUseHasRole = vi.fn();

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
  useHasRole: (...roles: string[]) => mockUseHasRole(...roles),
}));

// ---------------------------------------------------------------------------
// Mock adminTopicsApi
// ---------------------------------------------------------------------------

const mockApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  move: vi.fn(),
  archive: vi.fn(),
}));

vi.mock('@web/lib/admin-topics-api', () => ({
  adminTopicsApi: mockApi,
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import AdminTopicsPage from '@web/app/(protected)/admin/topics/page';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTopic(overrides: Partial<TopicNode> = {}): TopicNode {
  return {
    id: 'topic-1',
    parentId: null,
    title: 'Root Topic',
    content: '',
    status: 'draft',
    archived: false,
    order: 0,
    estimatedMinutes: 0,
    tags: [],
    prerequisiteIds: [],
    ...overrides,
  };
}

const MOCK_TOPICS: TopicNode[] = [
  makeTopic({ id: 'topic-1', title: 'Root Topic A', order: 0 }),
  makeTopic({ id: 'topic-2', title: 'Root Topic B', order: 1 }),
  makeTopic({ id: 'topic-1-child', parentId: 'topic-1', title: 'Child of A', order: 0 }),
];

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function setupAdminAuth() {
  mockUseAuth.mockReturnValue({ user: { id: 'u1', roles: [{ name: 'admin' }] }, accessToken: 'mock-token', isLoading: false });
  mockUseHasRole.mockReturnValue(true);
}

function setupStudentAuth() {
  mockUseAuth.mockReturnValue({ user: { id: 'u2', roles: [{ name: 'student' }] }, accessToken: 'mock-token', isLoading: false });
  mockUseHasRole.mockReturnValue(false);
}

function setupContentCreatorAuth() {
  mockUseAuth.mockReturnValue({ user: { id: 'u3', roles: [{ name: 'content_creator' }] }, accessToken: 'mock-token', isLoading: false });
  mockUseHasRole.mockReturnValue(true);
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  mockApi.list.mockResolvedValue(MOCK_TOPICS);
  mockApi.create.mockResolvedValue(makeTopic({ id: 'new-topic', title: 'New Root Topic' }));
  mockApi.update.mockResolvedValue(makeTopic({ id: 'topic-1', title: 'Updated Title' }));
  mockApi.move.mockResolvedValue(makeTopic({ id: 'topic-1' }));
  mockApi.archive.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

describe('RBAC', () => {
  it('redirects student to /dashboard', async () => {
    setupStudentAuth();
    render(<AdminTopicsPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });

  it('renders the page for admin', async () => {
    setupAdminAuth();
    render(<AdminTopicsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: /topic tree/i })).toBeInTheDocument());
  });

  it('renders the page for content_creator', async () => {
    setupContentCreatorAuth();
    render(<AdminTopicsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: /topic tree/i })).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Tree rendering
// ---------------------------------------------------------------------------

describe('Tree rendering', () => {
  it('shows root topics after loading', async () => {
    setupAdminAuth();
    render(<AdminTopicsPage />);
    await waitFor(() => {
      expect(screen.getByText('Root Topic A')).toBeInTheDocument();
      expect(screen.getByText('Root Topic B')).toBeInTheDocument();
    });
  });

  it('calls adminTopicsApi.list with the access token', async () => {
    setupAdminAuth();
    render(<AdminTopicsPage />);
    await waitFor(() => expect(mockApi.list).toHaveBeenCalledWith('mock-token'));
  });

  it('shows empty state when there are no topics', async () => {
    setupAdminAuth();
    mockApi.list.mockResolvedValue([]);
    render(<AdminTopicsPage />);
    await waitFor(() => expect(screen.getByText(/no topics yet/i)).toBeInTheDocument());
  });

  it('shows status badge for each topic', async () => {
    setupAdminAuth();
    render(<AdminTopicsPage />);
    await waitFor(() => {
      expect(screen.getAllByText('draft').length).toBeGreaterThan(0);
    });
  });

  it('expands a node to show children when the expand button is clicked', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    // Child is not visible initially
    expect(screen.queryByText('Child of A')).not.toBeInTheDocument();

    // Click the expand toggle on Root Topic A
    const nodeA = screen.getByTestId('topic-node-topic-1');
    const expandBtn = within(nodeA).getByRole('button', { name: /expand/i });
    await user.click(expandBtn);

    expect(screen.getByText('Child of A')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Create root topic
// ---------------------------------------------------------------------------

describe('Create root topic', () => {
  it('opens the create modal when "New Root Topic" is clicked', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    await user.click(screen.getByRole('button', { name: /new root topic/i }));

    expect(screen.getByRole('dialog', { name: /new root topic/i })).toBeInTheDocument();
  });

  it('calls create with no parentId and refreshes the tree', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    await user.click(screen.getByRole('button', { name: /new root topic/i }));

    const titleInput = screen.getByLabelText(/title/i);
    await user.type(titleInput, 'Brand New Topic');
    await user.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(mockApi.create).toHaveBeenCalledWith('mock-token', { title: 'Brand New Topic', parentId: null });
    });
    expect(mockApi.list).toHaveBeenCalledTimes(2); // initial + after create
  });

  it('shows validation error when title is empty', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    await user.click(screen.getByRole('button', { name: /new root topic/i }));
    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/title is required/i);
    expect(mockApi.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Create child topic
// ---------------------------------------------------------------------------

describe('Create child topic', () => {
  it('opens the create modal with the correct parent when "+ Child" is clicked', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const nodeA = screen.getByTestId('topic-node-topic-1');
    const addChildBtn = within(nodeA).getByRole('button', { name: /add child/i });
    await user.click(addChildBtn);

    expect(screen.getByRole('dialog', { name: /add child topic/i })).toBeInTheDocument();
  });

  it('calls create with the parentId of the target node', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const nodeA = screen.getByTestId('topic-node-topic-1');
    const addChildBtn = within(nodeA).getByRole('button', { name: /add child/i });
    await user.click(addChildBtn);

    const titleInput = screen.getByLabelText(/title/i);
    await user.type(titleInput, 'Child Topic');
    await user.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(mockApi.create).toHaveBeenCalledWith('mock-token', { title: 'Child Topic', parentId: 'topic-1' });
    });
  });
});

// ---------------------------------------------------------------------------
// Select and detail pane
// ---------------------------------------------------------------------------

describe('Detail pane', () => {
  it('shows placeholder text when no node is selected', async () => {
    setupAdminAuth();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));
    expect(screen.getByText(/select a topic/i)).toBeInTheDocument();
  });

  it('populates the detail pane when a node row is clicked', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const nodeRow = screen.getByTestId('topic-node-topic-1');
    await user.click(nodeRow);

    await waitFor(() => {
      expect(screen.getByText('Root Topic A', { selector: 'h2' })).toBeInTheDocument();
    });

    expect((screen.getByLabelText(/^title/i) as HTMLInputElement).value).toBe('Root Topic A');
  });

  it('calls update with all detail fields when Save is clicked', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    await user.click(screen.getByTestId('topic-node-topic-1'));
    await waitFor(() => screen.getByText('Root Topic A', { selector: 'h2' }));

    // Change status to published
    await user.selectOptions(screen.getByLabelText(/status/i), 'published');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockApi.update).toHaveBeenCalledWith(
        'mock-token',
        'topic-1',
        expect.objectContaining({ status: 'published' }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Inline title editing
// ---------------------------------------------------------------------------

describe('Inline title editing', () => {
  it('activates inline edit when the title button is clicked', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const titleBtn = screen.getByTestId('title-btn-topic-1');
    await user.click(titleBtn);

    expect(screen.getByTestId('inline-edit-topic-1')).toBeInTheDocument();
  });

  it('calls update when Enter is pressed in the inline input', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    await user.click(screen.getByTestId('title-btn-topic-1'));

    const input = screen.getByTestId('inline-edit-topic-1');
    await user.clear(input);
    await user.type(input, 'Renamed Topic{Enter}');

    await waitFor(() => {
      expect(mockApi.update).toHaveBeenCalledWith('mock-token', 'topic-1', { title: 'Renamed Topic' });
    });
  });

  it('cancels inline edit on Escape without calling update', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    await user.click(screen.getByTestId('title-btn-topic-1'));
    const input = screen.getByTestId('inline-edit-topic-1');
    await user.type(input, '{Escape}');

    await waitFor(() => {
      expect(screen.queryByTestId('inline-edit-topic-1')).not.toBeInTheDocument();
    });
    expect(mockApi.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

describe('Archive', () => {
  it('shows confirmation dialog when Archive is clicked', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const nodeA = screen.getByTestId('topic-node-topic-1');
    await user.click(within(nodeA).getByRole('button', { name: /archive root topic a/i }));

    expect(screen.getByRole('dialog', { name: /confirm action/i })).toBeInTheDocument();
    expect(screen.getByText(/archive "root topic a"/i)).toBeInTheDocument();
  });

  it('calls archive and refreshes on confirm', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const nodeA = screen.getByTestId('topic-node-topic-1');
    await user.click(within(nodeA).getByRole('button', { name: /archive root topic a/i }));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(mockApi.archive).toHaveBeenCalledWith('mock-token', 'topic-1');
    });
    expect(mockApi.list).toHaveBeenCalledTimes(2);
  });

  it('cancels archive when Cancel is clicked', async () => {
    setupAdminAuth();
    const user = userEvent.setup();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const nodeA = screen.getByTestId('topic-node-topic-1');
    await user.click(within(nodeA).getByRole('button', { name: /archive root topic a/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('dialog', { name: /confirm action/i })).not.toBeInTheDocument();
    expect(mockApi.archive).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

describe('Drag and drop', () => {
  it('calls move with before-position args when dragging node A onto node B', async () => {
    setupAdminAuth();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const dragHandle = screen.getByTestId('drag-handle-topic-1');
    const targetNode = screen.getByTestId('topic-node-topic-2');

    // Prototype spy so it applies to e.currentTarget regardless of object identity.
    // top:100 ensures (clientY - top) / height < 0 → 'before' for any realistic clientY.
    const gBCRSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100, height: 100, bottom: 200, left: 0, right: 200, width: 200, x: 0, y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.dragStart(dragHandle);
    fireEvent.dragOver(targetNode);
    fireEvent.drop(targetNode);

    await waitFor(() => {
      // 'before' position: newParentId = target.parentId (null), newSortOrder = target.order (1)
      expect(mockApi.move).toHaveBeenCalledWith('mock-token', 'topic-1', {
        newParentId: null,
        newSortOrder: 1,
      });
    });

    gBCRSpy.mockRestore();
  });

  it('calls move with child args when drop position is in the middle of the target', async () => {
    setupAdminAuth();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const dragHandle = screen.getByTestId('drag-handle-topic-1');
    const targetNode = screen.getByTestId('topic-node-topic-2');

    // Mock on Element prototype for consistency in JSDOM
    const gBCRSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0, height: 100, bottom: 100, left: 0, right: 200, width: 200, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.dragStart(dragHandle);
    
    // Use more explicit event creation to ensure clientY is preserved
    fireEvent(targetNode, new MouseEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: 50,
    }));
    
    fireEvent(targetNode, new MouseEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientY: 50,
    }));

    await waitFor(() => {
      expect(mockApi.move).toHaveBeenCalledWith('mock-token', 'topic-1', {
        newParentId: 'topic-2',
      });
    });

    gBCRSpy.mockRestore();

    gBCRSpy.mockRestore();
  });

  it('shows an error toast when move results in a cycle', async () => {
    setupAdminAuth();
    mockApi.move.mockRejectedValue(new Error('WOULD_CYCLE'));
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const dragHandle = screen.getByTestId('drag-handle-topic-1');
    const targetNode = screen.getByTestId('topic-node-topic-2');

    fireEvent.dragStart(dragHandle);
    fireEvent.dragOver(targetNode, { clientY: 0 });
    fireEvent.drop(targetNode, { clientY: 0 });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/circular dependency/i);
    });
  });

  it('does not call move when dropping a node onto itself', async () => {
    setupAdminAuth();
    render(<AdminTopicsPage />);
    await waitFor(() => screen.getByText('Root Topic A'));

    const dragHandle = screen.getByTestId('drag-handle-topic-1');
    const sameNode = screen.getByTestId('topic-node-topic-1');

    fireEvent.dragStart(dragHandle);
    fireEvent.dragOver(sameNode);
    fireEvent.drop(sameNode);

    await waitFor(() => expect(mockApi.move).not.toHaveBeenCalled());
  });
});
