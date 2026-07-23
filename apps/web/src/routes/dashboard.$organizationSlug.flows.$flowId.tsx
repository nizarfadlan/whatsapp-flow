import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button, buttonVariants } from "@whatsapp-flow/ui/components/button";
import { Card, CardContent } from "@whatsapp-flow/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@whatsapp-flow/ui/components/dialog";
import { Input } from "@whatsapp-flow/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@whatsapp-flow/ui/components/native-select";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	addEdge,
	Background,
	BackgroundVariant,
	type Connection,
	Controls,
	type Edge,
	MiniMap,
	type Node,
	ReactFlow,
	type ReactFlowInstance,
	useEdgesState,
	useNodesState,
} from "@xyflow/react";
import {
	AlertTriangle,
	ArrowLeft,
	GripVertical,
	Pencil,
	Play,
	Redo2,
	Save,
	ScrollText,
	Share2,
	Trash2,
	Undo2,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useActiveOrganization } from "@/components/active-organization";
import {
	categoryAccents,
	createNode,
	createTriggerNode,
	type FlowNodeData,
	getInteractiveOptionHandles,
	isInteractiveBranchNode,
	migrateLegacyNodes,
	nodeTypes,
	type PaletteNodeTypeName,
	paletteCategories,
	remapLegacyEdges,
	resetNodeIdCounter,
} from "@/components/flow-nodes";
import { NodeConfigPanel } from "@/components/node-config-panel";
import { useEditorStore } from "@/stores/editor-store";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute(
	"/dashboard/$organizationSlug/flows/$flowId",
)({
	component: FlowRoute,
});

function FlowRoute() {
	const location = useLocation();

	if (
		location.pathname.endsWith("/logs") ||
		location.pathname.endsWith("/sessions")
	) {
		return <Outlet />;
	}

	return <FlowEditor />;
}

function isTriggerType(type: string | undefined) {
	return type === "trigger";
}

function hasTriggerNode(nodes: Node[]) {
	return nodes.some((node) => isTriggerType(node.type));
}

function parseTriggerKeywords(data: { keyword?: string; keywords?: string[] }) {
	const keywords = data.keywords?.length
		? data.keywords
		: (data.keyword ?? "").split(/[\n,]/);
	const seen = new Set<string>();
	return keywords
		.map((keyword) => keyword.trim())
		.filter((keyword) => {
			const key = keyword.toLowerCase();
			if (!key || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

function getTriggerPayload(nodes: Node[]) {
	const triggerNode = nodes.find((node) => isTriggerType(node.type));
	const data = triggerNode?.data as FlowNodeData | undefined;
	if (data?.nodeType !== "trigger") return null;

	const messageTriggerConfig = {
		chatScope: data.chatScope ?? "any",
		groupTagIds: data.groupTagIds ?? [],
		senderTagIds: data.senderTagIds ?? [],
	};

	switch (data.triggerKind) {
		case "keyword":
			return {
				triggerType: "keyword" as const,
				triggerConfig: {
					keywords: parseTriggerKeywords(data),
					...messageTriggerConfig,
				},
			};
		case "any_message":
			return {
				triggerType: "any_message" as const,
				triggerConfig: messageTriggerConfig,
			};
		case "webhook":
			return {
				triggerType: "webhook" as const,
				triggerConfig: {},
			};
		case "schedule":
			return {
				triggerType: "schedule" as const,
				triggerConfig: {
					cronExpression: data.cronExpression ?? "",
					contactNumber: data.contactNumber ?? "",
				},
			};
		default:
			return null;
	}
}

function ensureTriggerNode(nodes: Node[]) {
	// Migrate legacy start/trigger-* nodes onto the unified trigger node.
	const migrated = migrateLegacyNodes(nodes);
	const existing = migrated.find((node) => node.id === "trigger");
	if (existing) {
		return migrated.map((node) =>
			node.id === "trigger"
				? {
						...node,
						type: "trigger",
						deletable: false,
						data: { ...createTriggerNode().data, ...(node.data as object) },
					}
				: node,
		);
	}

	return [createTriggerNode(), ...migrated];
}

function getSourceHandleLabel(
	nodes: Node[],
	sourceId?: string | null,
	handle?: string | null,
) {
	if (!handle) return undefined;
	if (handle === "true" || handle === "false") return handle;
	if (!handle.startsWith("option:") || !sourceId) return undefined;

	const sourceNode = nodes.find((node) => node.id === sourceId);
	const sourceData = sourceNode?.data as FlowNodeData | undefined;
	if (!sourceData || !isInteractiveBranchNode(sourceData)) return undefined;
	const option = getInteractiveOptionHandles(sourceData).find(
		(item) => item.id === handle,
	);
	return option ? `${option.index}. ${option.label}` : undefined;
}

function reconcileInteractiveEdges(
	edges: Edge[],
	nodeId: string,
	data: FlowNodeData,
) {
	if (!isInteractiveBranchNode(data)) return edges;
	const validOptions = new Map(
		getInteractiveOptionHandles(data).map((option) => [option.id, option]),
	);

	return edges.map((edge) => {
		if (edge.source !== nodeId || !edge.sourceHandle?.startsWith("option:")) {
			return edge;
		}
		const option = validOptions.get(edge.sourceHandle);
		return option
			? { ...edge, label: `${option.index}. ${option.label}` }
			: edge;
	});
}

function ShareFlowDialog({
	flowId,
	tenantId,
	ownerId,
}: {
	flowId: string;
	tenantId: string;
	ownerId: string;
}) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [memberId, setMemberId] = useState("");
	const [capability, setCapability] = useState<"viewer" | "editor">("viewer");
	const membersQuery = useQuery({
		...trpc.tenant.listMembers.queryOptions({ tenantId }),
		enabled: open,
	});
	const grantsQuery = useQuery({
		...trpc.tenant.listFlowGrants.queryOptions({ tenantId, flowId }),
		enabled: open,
	});
	const refetchSharing = () => {
		void grantsQuery.refetch();
		void membersQuery.refetch();
	};
	const grantAccess = useMutation(
		trpc.tenant.grantFlowAccess.mutationOptions({
			onSuccess: () => {
				setMemberId("");
				toast.success("Flow access updated");
				refetchSharing();
			},
			onError: () => toast.error("Unable to update flow access"),
		}),
	);
	const revokeAccess = useMutation(
		trpc.tenant.revokeFlowAccess.mutationOptions({
			onSuccess: () => {
				toast.success("Flow access revoked");
				refetchSharing();
			},
			onError: () => toast.error("Unable to revoke flow access"),
		}),
	);
	const grants = grantsQuery.data ?? [];
	const grantedUserIds = new Set(grants.map((grant) => grant.userId));
	const eligibleMembers = (membersQuery.data ?? []).filter(
		(member) => member.id !== ownerId && !grantedUserIds.has(member.id),
	);
	const isLoading = membersQuery.isLoading || grantsQuery.isLoading;

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (!nextOpen) setMemberId("");
			}}
		>
			<DialogTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 text-xs"
					/>
				}
			>
				<Share2 className="size-3.5" />
				Share
			</DialogTrigger>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Share flow</DialogTitle>
					<DialogDescription>
						Give active members of this workspace view-only or editing access.
					</DialogDescription>
				</DialogHeader>
				{isLoading ? (
					<p className="py-6 text-center text-muted-foreground text-sm">
						Loading sharing settings...
					</p>
				) : membersQuery.error || grantsQuery.error ? (
					<div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
						<p className="text-destructive text-sm">
							Unable to load sharing settings. Try again.
						</p>
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={refetchSharing}
						>
							Retry
						</Button>
					</div>
				) : (
					<div className="space-y-5">
						<div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
							<NativeSelect
								value={memberId}
								onChange={(event) => setMemberId(event.target.value)}
							>
								<NativeSelectOption value="">
									Select a member
								</NativeSelectOption>
								{eligibleMembers.map((member) => (
									<NativeSelectOption key={member.id} value={member.id}>
										{member.name || member.email}
									</NativeSelectOption>
								))}
							</NativeSelect>
							<NativeSelect
								value={capability}
								onChange={(event) =>
									setCapability(event.target.value as "viewer" | "editor")
								}
							>
								<NativeSelectOption value="viewer">Viewer</NativeSelectOption>
								<NativeSelectOption value="editor">Editor</NativeSelectOption>
							</NativeSelect>
							<Button
								type="button"
								disabled={!memberId || grantAccess.isPending}
								onClick={() =>
									grantAccess.mutate({
										tenantId,
										flowId,
										userId: memberId,
										capability,
									})
								}
							>
								{grantAccess.isPending ? "Sharing..." : "Share"}
							</Button>
						</div>
						{grants.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Only you can access this flow.
							</p>
						) : (
							<div className="divide-y rounded-md border">
								{grants.map((grant) => (
									<div
										key={grant.userId}
										className="flex flex-wrap items-center gap-3 p-3"
									>
										<div className="min-w-0 flex-1">
											<p className="truncate font-medium text-sm">
												{grant.name || grant.email}
											</p>
											<p className="truncate text-muted-foreground text-xs">
												{grant.email}
											</p>
										</div>
										<NativeSelect
											value={grant.capability}
											disabled={grantAccess.isPending || revokeAccess.isPending}
											onChange={(event) =>
												grantAccess.mutate({
													tenantId,
													flowId,
													userId: grant.userId,
													capability: event.target.value as "viewer" | "editor",
												})
											}
										>
											<NativeSelectOption value="viewer">
												Viewer
											</NativeSelectOption>
											<NativeSelectOption value="editor">
												Editor
											</NativeSelectOption>
										</NativeSelect>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											disabled={grantAccess.isPending || revokeAccess.isPending}
											onClick={() =>
												revokeAccess.mutate({
													tenantId,
													flowId,
													userId: grant.userId,
												})
											}
											title={`Revoke access for ${grant.name || grant.email}`}
										>
											<Trash2 className="size-3.5" />
											<span className="sr-only">Revoke access</span>
										</Button>
									</div>
								))}
							</div>
						)}
					</div>
				)}
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => setOpen(false)}
					>
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FlowEditor() {
	const organization = useActiveOrganization();
	const { flowId } = Route.useParams();
	const trpc = useTRPC();
	const { data: flow, refetch } = useSuspenseQuery(
		trpc.flow.getById.queryOptions({ id: flowId, tenantId: organization.id }),
	);
	const isOwner = flow.accessCapability === "owner";
	const canEdit = isOwner;

	const [nodes, setNodes, onNodesChange] = useNodesState(
		ensureTriggerNode((flow.nodes as Node[]) ?? []),
	);
	const [edges, setEdges, onEdgesChange] = useEdgesState(
		remapLegacyEdges(
			(flow.edges as Edge[]) ?? [],
			(flow.nodes as Node[]) ?? [],
		),
	);

	const initialized = useRef(false);
	const validationRequest = useRef(0);
	const [reactFlowInstance, setReactFlowInstance] =
		useState<ReactFlowInstance | null>(null);
	const [renameOpen, setRenameOpen] = useState(false);
	const [renameValue, setRenameValue] = useState(flow.name);
	const [graphDiagnostics, setGraphDiagnostics] = useState(
		flow.graphDiagnostics,
	);

	const pushHistory = useEditorStore((s) => s.pushHistory);
	const undo = useEditorStore((s) => s.undo);
	const redo = useEditorStore((s) => s.redo);
	const canUndo = useEditorStore((s) => s.canUndo);
	const canRedo = useEditorStore((s) => s.canRedo);
	const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
	const selectNode = useEditorStore((s) => s.selectNode);
	const isDirty = useEditorStore((s) => s.isDirty);
	const markSaved = useEditorStore((s) => s.markSaved);
	const reset = useEditorStore((s) => s.reset);
	const { mutate: validateGraph } = useMutation(
		trpc.flow.validateGraph.mutationOptions(),
	);
	const validationGraph = useMemo(
		() =>
			JSON.stringify({
				nodes: nodes.map((node) => ({
					id: node.id,
					type: node.type,
					data: node.data,
				})),
				edges: edges.map((edge) => ({
					id: edge.id,
					source: edge.source,
					target: edge.target,
					sourceHandle: edge.sourceHandle,
				})),
			}),
		[nodes, edges],
	);

	useEffect(() => {
		resetNodeIdCounter();
		reset();
		initialized.current = false;
	}, [reset]);

	useEffect(() => {
		setRenameValue(flow.name);
	}, [flow.name]);

	useEffect(() => {
		setGraphDiagnostics(flow.graphDiagnostics);
	}, [flow.graphDiagnostics]);

	useEffect(() => {
		const requestId = ++validationRequest.current;
		const timeout = window.setTimeout(() => {
			const graph = JSON.parse(validationGraph) as {
				nodes: Record<string, unknown>[];
				edges: Record<string, unknown>[];
			};
			validateGraph(
				{
					id: flowId,
					tenantId: organization.id,
					nodes: graph.nodes,
					edges: graph.edges,
				},
				{
					onSuccess: (diagnostics) => {
						if (requestId === validationRequest.current) {
							setGraphDiagnostics(diagnostics);
						}
					},
				},
			);
		}, 250);
		return () => window.clearTimeout(timeout);
	}, [flowId, organization.id, validateGraph, validationGraph]);

	useEffect(() => {
		if (initialized.current) return;
		if (nodes.length > 0 || edges.length > 0) {
			pushHistory(nodes, edges);
			initialized.current = true;
		}
	}, [nodes, edges, pushHistory]);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (!canEdit) return;
			setEdges((eds) => {
				const label = getSourceHandleLabel(
					nodes,
					connection.source,
					connection.sourceHandle,
				);
				const next = addEdge({ ...connection, label, type: "smoothstep" }, eds);
				pushHistory(nodes, next);
				return next;
			});
		},
		[canEdit, setEdges, pushHistory, nodes],
	);

	const onNodeClick = useCallback(
		(_e: React.MouseEvent, node: Node) => selectNode(node.id),
		[selectNode],
	);

	const onPaneClick = useCallback(() => selectNode(null), [selectNode]);

	const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
	const diagnosticNodeIds = useMemo(
		() => new Set(graphDiagnostics.map((diagnostic) => diagnostic.nodeId)),
		[graphDiagnostics],
	);
	const diagnosticEdgeIds = useMemo(
		() =>
			new Set(
				graphDiagnostics.flatMap((diagnostic) =>
					diagnostic.edgeId ? [diagnostic.edgeId] : [],
				),
			),
		[graphDiagnostics],
	);
	const displayNodes = useMemo(
		() =>
			nodes.map((node) =>
				diagnosticNodeIds.has(node.id)
					? {
							...node,
							style: {
								...node.style,
								outline: "2px solid var(--destructive)",
								outlineOffset: 2,
							},
						}
					: node,
			),
		[nodes, diagnosticNodeIds],
	);
	const displayEdges = useMemo(
		() =>
			edges.map((edge) =>
				diagnosticEdgeIds.has(edge.id)
					? {
							...edge,
							animated: true,
							style: {
								...edge.style,
								stroke: "var(--destructive)",
								strokeWidth: 2.5,
							},
						}
					: edge,
			),
		[edges, diagnosticEdgeIds],
	);

	const updateNodeData = useCallback(
		(id: string, data: Partial<FlowNodeData>) => {
			if (!canEdit) return;
			setNodes((nds) => {
				let updatedData: FlowNodeData | null = null;
				const nextNodes = nds.map((node) => {
					if (node.id !== id) return node;
					const nextData = {
						...(node.data as unknown as FlowNodeData),
						...data,
					} as FlowNodeData;
					updatedData = nextData;
					return {
						...node,
						data: nextData as unknown as Record<string, unknown>,
					};
				});

				const nextEdges = updatedData
					? reconcileInteractiveEdges(edges, id, updatedData)
					: edges;
				if (nextEdges !== edges) setEdges(nextEdges);
				pushHistory(nextNodes, nextEdges);
				return nextNodes;
			});
		},
		[canEdit, setNodes, setEdges, pushHistory, edges],
	);

	const deleteNode = useCallback(
		(id: string) => {
			if (!canEdit || id === "trigger") return;
			setNodes((nds) => {
				const nextNodes = nds.filter((n) => n.id !== id);
				setEdges((eds) => {
					const nextEdges = eds.filter(
						(e) => e.source !== id && e.target !== id,
					);
					pushHistory(nextNodes, nextEdges);
					return nextEdges;
				});
				if (selectedNodeId === id) selectNode(null);
				return nextNodes;
			});
		},
		[canEdit, setNodes, setEdges, pushHistory, selectedNodeId, selectNode],
	);

	const focusDiagnostic = useCallback(
		(diagnostic: (typeof graphDiagnostics)[number]) => {
			selectNode(diagnostic.nodeId);
			setNodes((current) =>
				current.map((node) => ({
					...node,
					selected: node.id === diagnostic.nodeId,
				})),
			);
			setEdges((current) =>
				current.map((edge) => ({
					...edge,
					selected: edge.id === diagnostic.edgeId,
				})),
			);
			const target = nodes.find((node) => node.id === diagnostic.nodeId);
			if (target) {
				void reactFlowInstance?.fitView({
					nodes: [target],
					padding: 0.8,
					duration: 300,
				});
			}
		},
		[selectNode, setNodes, setEdges, nodes, reactFlowInstance],
	);

	const removeDiagnosticEdge = useCallback(
		(edgeId: string) => {
			setEdges((current) => {
				const nextEdges = current.filter((edge) => edge.id !== edgeId);
				pushHistory(nodes, nextEdges);
				return nextEdges;
			});
		},
		[setEdges, pushHistory, nodes],
	);

	const saveMut = useMutation(
		trpc.flow.update.mutationOptions({
			onSuccess: (updated) => {
				setGraphDiagnostics(updated.graphDiagnostics);
				markSaved();
				toast.success("Flow saved");
				refetch();
			},
			onError: () => toast.error("Failed to save"),
		}),
	);
	const renameMut = useMutation(
		trpc.flow.update.mutationOptions({
			onSuccess: () => {
				setRenameOpen(false);
				toast.success("Flow renamed");
				refetch();
			},
			onError: () => toast.error("Failed to rename flow"),
		}),
	);

	const handleRename = () => {
		const name = renameValue.trim();
		if (!name || name === flow.name) return;
		renameMut.mutate({ id: flowId, name, tenantId: organization.id });
	};

	const handleSave = () => {
		const triggerPayload = getTriggerPayload(nodes);

		saveMut.mutate({
			id: flowId,
			tenantId: organization.id,
			nodes: nodes as unknown as Record<string, unknown>[],
			edges: edges as unknown as Record<string, unknown>[],
			...(triggerPayload && {
				triggerType: triggerPayload.triggerType,
				triggerConfig: triggerPayload.triggerConfig,
			}),
		});
	};

	const handleAddNode = (type: PaletteNodeTypeName) => {
		if (!canEdit) return;
		const yOffset = Math.random() * 200 + 50;
		setNodes((nds) => {
			const next = [...nds, createNode(type, 320, yOffset)];
			pushHistory(next, edges);
			return next;
		});
	};

	const handlePaletteDragStart = (
		e: React.DragEvent,
		type: PaletteNodeTypeName,
	) => {
		e.dataTransfer.setData("application/whatsapp-flow-node", type);
		e.dataTransfer.effectAllowed = "move";
	};

	const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
	}, []);

	const handleCanvasDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			if (!canEdit) return;
			const type = e.dataTransfer.getData(
				"application/whatsapp-flow-node",
			) as PaletteNodeTypeName;
			if (!type || !reactFlowInstance) return;

			if (isTriggerType(type) && hasTriggerNode(nodes)) {
				toast.error("Only one trigger node allowed per flow");
				return;
			}

			const position = reactFlowInstance.screenToFlowPosition({
				x: e.clientX,
				y: e.clientY,
			});
			setNodes((nds) => {
				const next = [...nds, createNode(type, position.x, position.y)];
				pushHistory(next, edges);
				return next;
			});
		},
		[canEdit, reactFlowInstance, setNodes, pushHistory, edges, nodes],
	);

	const handleUndo = useCallback(() => {
		const entry = undo();
		if (entry) {
			setNodes(entry.nodes);
			setEdges(entry.edges);
		}
	}, [undo, setNodes, setEdges]);

	const handleRedo = useCallback(() => {
		const entry = redo();
		if (entry) {
			setNodes(entry.nodes);
			setEdges(entry.edges);
		}
	}, [redo, setNodes, setEdges]);

	const handleDeleteKey = useCallback(
		(e: KeyboardEvent) => {
			if (
				(e.key === "Delete" || e.key === "Backspace") &&
				selectedNodeId &&
				(e.target as HTMLElement)?.tagName !== "INPUT" &&
				(e.target as HTMLElement)?.tagName !== "TEXTAREA" &&
				(e.target as HTMLElement)?.tagName !== "SELECT"
			) {
				deleteNode(selectedNodeId);
			}
			if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
				e.preventDefault();
				handleUndo();
			}
			if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
				e.preventDefault();
				handleRedo();
			}
		},
		[selectedNodeId, deleteNode, handleUndo, handleRedo],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleDeleteKey);
		return () => window.removeEventListener("keydown", handleDeleteKey);
	}, [handleDeleteKey]);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
			<div className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
				<div className="flex items-center gap-3">
					<Link
						to="/dashboard/$organizationSlug/flows"
						params={{ organizationSlug: organization.slug }}
						className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
					>
						<ArrowLeft className="size-3.5" />
						Back
					</Link>
					<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
						<div className="flex items-center gap-1">
							<h1 className="font-semibold text-sm">
								{flow.name}
								{isDirty && (
									<span className="ml-1 text-[10px] text-muted-foreground">
										(unsaved)
									</span>
								)}
							</h1>
							<DialogTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										title={
											isOwner
												? "Rename flow"
												: "Only the owner can rename this flow"
										}
										disabled={!isOwner}
									/>
								}
							>
								<Pencil className="size-3" />
							</DialogTrigger>
						</div>
						<DialogContent className="sm:max-w-sm">
							<DialogHeader>
								<DialogTitle>Rename flow</DialogTitle>
								<DialogDescription>
									Update the display name for this flow.
								</DialogDescription>
							</DialogHeader>
							<Input
								value={renameValue}
								onChange={(event) => setRenameValue(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") handleRename();
								}}
								placeholder="Flow name"
							/>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => setRenameOpen(false)}
								>
									Cancel
								</Button>
								<Button
									type="button"
									onClick={handleRename}
									disabled={
										renameMut.isPending ||
										!renameValue.trim() ||
										renameValue.trim() === flow.name
									}
								>
									{renameMut.isPending ? "Saving..." : "Rename"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
					<Badge
						variant={
							flow.status === "active"
								? "default"
								: flow.status === "paused"
									? "secondary"
									: "outline"
						}
						className="h-4 px-1.5 text-[9px]"
					>
						{flow.status}
					</Badge>
					<Badge
						variant={isOwner ? "secondary" : "outline"}
						className="h-4 px-1.5 text-[9px]"
					>
						{isOwner ? "Owned" : `Shared · ${flow.accessCapability}`}
					</Badge>
					{!isOwner && flow.owner && (
						<span className="max-w-52 truncate text-muted-foreground text-xs">
							Shared by {flow.owner.name} · {flow.owner.email}
						</span>
					)}

					<Link
						to="/dashboard/$organizationSlug/flows/$flowId/sessions"
						params={{ organizationSlug: organization.slug, flowId }}
						className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
					>
						<Users className="size-3.5" />
						Sessions
					</Link>
					<Link
						to="/dashboard/$organizationSlug/flows/$flowId/logs"
						params={{ organizationSlug: organization.slug, flowId }}
						className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
					>
						<ScrollText className="size-3.5" />
						Logs
					</Link>
				</div>
				<div className="flex items-center gap-2">
					{isOwner && (
						<ShareFlowDialog
							flowId={flowId}
							tenantId={flow.tenantId}
							ownerId={flow.userId}
						/>
					)}

					<Button
						variant="ghost"
						size="icon-sm"
						disabled={!canEdit || !canUndo}
						onClick={handleUndo}
						title="Undo (Ctrl+Z)"
					>
						<Undo2 className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={!canEdit || !canRedo}
						onClick={handleRedo}
						title="Redo (Ctrl+Shift+Z)"
					>
						<Redo2 className="size-3.5" />
					</Button>
					<DeployDialog
						flowId={flowId}
						flowName={flow.name}
						disabled={!canEdit || nodes.length === 0}
					/>
					<Button
						size="sm"
						className="h-7 text-xs"
						onClick={handleSave}
						disabled={!canEdit || saveMut.isPending}
					>
						<Save className="size-3.5" />
						{saveMut.isPending ? "Saving..." : "Save"}
					</Button>
				</div>
			</div>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<Card className="w-64 shrink-0 overflow-y-auto rounded-none border-0 border-r bg-card/80">
					<CardContent className="flex flex-col gap-4 p-4">
						<div>
							<p className="font-medium text-sm">Add Nodes</p>
							<p className="text-muted-foreground text-xs">
								Click or drag to canvas
							</p>
						</div>
						{paletteCategories.map((cat) => (
							<div key={cat.label} className="flex flex-col gap-1.5">
								<p className="px-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
									{cat.label}
								</p>
								{cat.items.map((item) => {
									const accent = categoryAccents[item.category];
									return (
										<Button
											key={item.type}
											type="button"
											variant="ghost"
											className="group/palette h-9 justify-start gap-2 rounded-lg border border-border/70 bg-background/70 px-2.5 text-xs shadow-xs hover:bg-muted"
											draggable={canEdit}
											disabled={!canEdit}
											onDragStart={(e) => handlePaletteDragStart(e, item.type)}
											onClick={() => handleAddNode(item.type)}
										>
											<GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground/30 group-hover/palette:text-muted-foreground/60" />
											<span
												className={cn(
													"flex size-5 items-center justify-center rounded-md",
													accent.chip,
												)}
											>
												<item.icon className={cn("size-3", accent.icon)} />
											</span>
											<span className="truncate">{item.label}</span>
										</Button>
									);
								})}
							</div>
						))}
					</CardContent>
				</Card>

				<Card className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-muted/20">
					<CardContent className="h-full min-h-0 flex-1 p-0">
						<ReactFlow
							className="size-full"
							nodes={displayNodes}
							nodesDraggable={canEdit}
							nodesConnectable={canEdit}
							edges={displayEdges}
							onNodesChange={onNodesChange}
							onEdgesChange={onEdgesChange}
							onConnect={onConnect}
							onNodeClick={onNodeClick}
							onPaneClick={onPaneClick}
							onInit={setReactFlowInstance}
							onDrop={handleCanvasDrop}
							onDragOver={handleCanvasDragOver}
							nodeTypes={nodeTypes}
							fitView
							fitViewOptions={{ padding: 0.2 }}
							deleteKeyCode={null}
							proOptions={{ hideAttribution: true }}
						>
							<Background variant={BackgroundVariant.Dots} gap={24} size={1} />
							<Controls
								position="bottom-left"
								showInteractive={false}
								className="flow-controls"
							/>
							<MiniMap
								position="bottom-right"
								pannable
								zoomable
								maskColor="rgb(0 0 0 / 0.08)"
								nodeColor={() => "var(--primary)"}
								nodeStrokeColor={() => "var(--background)"}
								className="flow-minimap"
							/>
						</ReactFlow>
					</CardContent>
				</Card>

				<Card className="w-80 shrink-0 overflow-y-auto rounded-none border-0 border-l bg-card/80">
					<CardContent className="p-0">
						{graphDiagnostics.length > 0 && (
							<div className="flex flex-col gap-2 border-b p-3">
								<div className="flex items-center gap-2 font-medium text-destructive text-xs">
									<AlertTriangle className="size-3.5" />
									Graph issues ({graphDiagnostics.length})
								</div>
								{graphDiagnostics.map((diagnostic, index) => (
									<div
										key={`${diagnostic.issueCode}-${diagnostic.edgeId ?? diagnostic.nodeId}-${index}`}
										className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2"
									>
										<p className="text-[11px] leading-relaxed">
											{diagnostic.message}
										</p>
										{diagnostic.missingHandles?.length ? (
											<p className="text-[10px] text-muted-foreground">
												Missing: {diagnostic.missingHandles.join(", ")}
											</p>
										) : null}
										<div className="flex gap-1">
											<Button
												type="button"
												variant="outline"
												size="xs"
												onClick={() => focusDiagnostic(diagnostic)}
											>
												Focus
											</Button>
											{diagnostic.edgeId && (
												<Button
													type="button"
													variant="outline"
													size="xs"
													className="text-destructive"
													onClick={() => {
														if (diagnostic.edgeId) {
															removeDiagnosticEdge(diagnostic.edgeId);
														}
													}}
												>
													Delete edge
												</Button>
											)}
										</div>
									</div>
								))}
								<p className="text-[10px] text-muted-foreground">
									Reconnect missing branches manually from the highlighted
									option handle.
								</p>
							</div>
						)}
						<NodeConfigPanel
							node={selectedNode}
							flowId={flowId}
							canRotateWebhookToken={flow.accessCapability === "owner"}
							allNodes={nodes}
							edges={edges}
							onUpdate={updateNodeData}
							onDelete={deleteNode}
						/>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

function DeployDialog({
	flowId,
	flowName,
	disabled,
}: {
	flowId: string;
	flowName: string;
	disabled: boolean;
}) {
	const organization = useActiveOrganization();
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [deviceId, setDeviceId] = useState("");

	const { data: devices } = useSuspenseQuery(
		trpc.device.listForDeploy.queryOptions({
			flowId,
			tenantId: organization.id,
		}),
	);

	const deployMut = useMutation(
		trpc.flow.deploy.mutationOptions({
			onSuccess: () => {
				setOpen(false);
				toast.success(`"${flowName}" deployed`);
			},
			onError: (err) => toast.error(err.message ?? "Deploy failed"),
		}),
	);

	useEffect(() => {
		if (open && devices && devices.length > 0 && !deviceId) {
			setDeviceId(devices[0].id);
		}
	}, [open, devices, deviceId]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				disabled={disabled}
				className={cn(buttonVariants({ size: "sm" }), "h-7 text-xs")}
			>
				<Play className="size-3.5" />
				Deploy
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Deploy Flow</DialogTitle>
					<DialogDescription>
						Select device to run this flow on.
					</DialogDescription>
				</DialogHeader>
				{devices && devices.length > 0 ? (
					<div className="flex flex-col gap-1">
						{devices.map((d) => {
							return (
								<Button
									key={d.id}
									type="button"
									variant="ghost"
									className={cn(
										"h-auto justify-start rounded-lg border px-3 py-2 text-left text-xs",
										deviceId === d.id
											? "border-primary bg-primary/10"
											: "border-border hover:bg-muted",
									)}
									onClick={() => setDeviceId(d.id)}
								>
									<span className="flex flex-col items-start gap-0.5">
										<span className="font-medium">{d.name}</span>
										<span className="text-[10px] text-muted-foreground">
											{d.provider} · {d.status}
										</span>
									</span>
								</Button>
							);
						})}
					</div>
				) : (
					<p className="text-muted-foreground text-xs">
						No devices available. Add device first.
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" size="sm" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						size="sm"
						disabled={!deviceId || deployMut.isPending}
						onClick={() =>
							deployMut.mutate({
								id: flowId,
								deviceId,
								tenantId: organization.id,
							})
						}
					>
						{deployMut.isPending ? "Deploying..." : "Deploy"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
