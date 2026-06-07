import type { Edge, Node } from "@xyflow/react";
import { create } from "zustand";

interface HistoryEntry {
	nodes: Node[];
	edges: Edge[];
}

interface EditorState {
	// History
	history: HistoryEntry[];
	historyIndex: number;
	canUndo: boolean;
	canRedo: boolean;

	// Selection
	selectedNodeId: string | null;

	// Dirty tracking
	lastSavedAt: number | null;
	isDirty: boolean;

	// Palette
	paletteOpen: boolean;

	// Actions
	pushHistory: (nodes: Node[], edges: Edge[]) => void;
	undo: () => HistoryEntry | null;
	redo: () => HistoryEntry | null;
	selectNode: (id: string | null) => void;
	markSaved: () => void;
	markDirty: () => void;
	togglePalette: () => void;
	setPaletteOpen: (open: boolean) => void;
	reset: () => void;
}

const MAX_HISTORY = 50;

export const useEditorStore = create<EditorState>((set, get) => ({
	history: [],
	historyIndex: -1,
	canUndo: false,
	canRedo: false,
	selectedNodeId: null,
	lastSavedAt: null,
	isDirty: false,
	paletteOpen: false,

	pushHistory: (nodes, edges) => {
		const { history, historyIndex } = get();
		// Serialize to plain objects to avoid reference issues
		const entry: HistoryEntry = {
			nodes: JSON.parse(JSON.stringify(nodes)),
			edges: JSON.parse(JSON.stringify(edges)),
		};
		const newHistory = history.slice(0, historyIndex + 1);
		newHistory.push(entry);
		if (newHistory.length > MAX_HISTORY) newHistory.shift();
		set({
			history: newHistory,
			historyIndex: newHistory.length - 1,
			canUndo: newHistory.length > 1,
			canRedo: false,
			isDirty: true,
		});
	},

	undo: () => {
		const { history, historyIndex } = get();
		if (historyIndex <= 0) return null;
		const newIndex = historyIndex - 1;
		set({
			historyIndex: newIndex,
			canUndo: newIndex > 0,
			canRedo: true,
		});
		return history[newIndex];
	},

	redo: () => {
		const { history, historyIndex } = get();
		if (historyIndex >= history.length - 1) return null;
		const newIndex = historyIndex + 1;
		set({
			historyIndex: newIndex,
			canUndo: true,
			canRedo: newIndex < history.length - 1,
		});
		return history[newIndex];
	},

	selectNode: (id) => set({ selectedNodeId: id }),
	markSaved: () => set({ isDirty: false, lastSavedAt: Date.now() }),
	markDirty: () => set({ isDirty: true }),
	togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
	setPaletteOpen: (open) => set({ paletteOpen: open }),
	reset: () =>
		set({
			history: [],
			historyIndex: -1,
			canUndo: false,
			canRedo: false,
			selectedNodeId: null,
			lastSavedAt: null,
			isDirty: false,
			paletteOpen: false,
		}),
}));
