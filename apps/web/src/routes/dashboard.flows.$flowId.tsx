import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
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
	ArrowLeft,
	GripVertical,
	Play,
	Redo2,
	Save,
	ScrollText,
	Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	categoryAccents,
	createNode,
	createStartNode,
	type FlowNodeData,
	nodeTypes,
	type PaletteNodeTypeName,
	paletteCategories,
	resetNodeIdCounter,
} from "@/components/flow-nodes";
import { NodeConfigPanel } from "@/components/node-config-panel";
import { useEditorStore } from "@/stores/editor-store";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/flows/$flowId")({
	component: FlowRoute,
});

function FlowRoute() {
	const location = useLocation();

	if (location.pathname.endsWith("/logs")) {
		return <Outlet />;
	}

	return <FlowEditor />;
}

function isTriggerType(type: string | undefined) {
	return type?.startsWith("trigger-") ?? false;
}

function hasTriggerNode(nodes: Node[]) {
	return nodes.some((node) => isTriggerType(node.type));
}

function getTriggerPayload(nodes: Node[]) {
	const triggerNode = nodes.find((node) => isTriggerType(node.type));
	const data = triggerNode?.data as FlowNodeData | undefined;

	switch (data?.nodeType) {
		case "trigger-keyword":
			return {
				triggerType: "keyword" as const,
				triggerConfig: {
					keyword: "keyword" in data ? (data.keyword ?? "") : "",
				},
			};
		case "trigger-any":
			return { triggerType: "any_message" as const, triggerConfig: null };
		case "trigger-webhook":
			return {
				triggerType: "webhook" as const,
				triggerConfig: {
					webhookToken: "webhookToken" in data ? (data.webhookToken ?? "") : "",
				},
			};
		case "trigger-schedule":
			return {
				triggerType: "schedule" as const,
				triggerConfig: {
					cronExpression:
						"cronExpression" in data ? (data.cronExpression ?? "") : "",
					contactNumber:
						"contactNumber" in data ? (data.contactNumber ?? "") : "",
				},
			};
		default:
			return null;
	}
}

function ensureStartNode(nodes: Node[]) {
	const withoutDuplicateStart = nodes.filter(
		(node, index) =>
			node.id !== "start" || index === nodes.findIndex((n) => n.id === "start"),
	);
	const existing = withoutDuplicateStart.find((node) => node.id === "start");
	if (existing) {
		return withoutDuplicateStart.map((node) =>
			node.id === "start"
				? {
						...node,
						type: "start",
						deletable: false,
						data: createStartNode().data,
					}
				: node,
		);
	}

	return [createStartNode(), ...withoutDuplicateStart];
}

function FlowEditor() {
	const { flowId } = Route.useParams();
	const trpc = useTRPC();
	const { data: flow, refetch } = useSuspenseQuery(
		trpc.flow.getById.queryOptions({ id: flowId }),
	);

	const [nodes, setNodes, onNodesChange] = useNodesState(
		ensureStartNode((flow.nodes as Node[]) ?? []),
	);
	const [edges, setEdges, onEdgesChange] = useEdgesState(
		(flow.edges as Edge[]) ?? [],
	);

	const initialized = useRef(false);
	const [reactFlowInstance, setReactFlowInstance] =
		useState<ReactFlowInstance | null>(null);

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

	useEffect(() => {
		resetNodeIdCounter();
		reset();
		initialized.current = false;
	}, [reset]);

	useEffect(() => {
		if (initialized.current) return;
		if (nodes.length > 0 || edges.length > 0) {
			pushHistory(nodes, edges);
			initialized.current = true;
		}
	}, [nodes, edges, pushHistory]);

	const onConnect = useCallback(
		(connection: Connection) => {
			setEdges((eds) => {
				const branchLabel =
					connection.sourceHandle === "true" ||
					connection.sourceHandle === "false"
						? connection.sourceHandle
						: undefined;
				const next = addEdge(
					{ ...connection, label: branchLabel, type: "smoothstep" },
					eds,
				);
				pushHistory(nodes, next);
				return next;
			});
		},
		[setEdges, pushHistory, nodes],
	);

	const onNodeClick = useCallback(
		(_e: React.MouseEvent, node: Node) => selectNode(node.id),
		[selectNode],
	);

	const onPaneClick = useCallback(() => selectNode(null), [selectNode]);

	const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

	const updateNodeData = useCallback(
		(id: string, data: Partial<FlowNodeData>) => {
			setNodes((nds) => {
				const next = nds.map((n) =>
					n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
				);
				pushHistory(next, edges);
				return next;
			});
		},
		[setNodes, pushHistory, edges],
	);

	const deleteNode = useCallback(
		(id: string) => {
			if (id === "start") return;
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
		[setNodes, setEdges, pushHistory, selectedNodeId, selectNode],
	);

	const saveMut = useMutation(
		trpc.flow.update.mutationOptions({
			onSuccess: () => {
				markSaved();
				toast.success("Flow saved");
				refetch();
			},
			onError: () => toast.error("Failed to save"),
		}),
	);

	const handleSave = () => {
		const triggerPayload = getTriggerPayload(nodes);

		saveMut.mutate({
			id: flowId,
			nodes: nodes as unknown as Record<string, unknown>[],
			edges: edges as unknown as Record<string, unknown>[],
			...(triggerPayload && {
				triggerType: triggerPayload.triggerType,
				triggerConfig: triggerPayload.triggerConfig,
			}),
		});
	};

	const handleAddNode = (type: PaletteNodeTypeName) => {
		if (isTriggerType(type) && hasTriggerNode(nodes)) {
			toast.error("Only one trigger node allowed per flow");
			return;
		}
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
		[reactFlowInstance, setNodes, pushHistory, edges, nodes],
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
						to="/dashboard/flows"
						className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
					>
						<ArrowLeft className="size-3.5" />
						Back
					</Link>
					<h1 className="font-semibold text-sm">
						{flow.name}
						{isDirty && (
							<span className="ml-1 text-[10px] text-muted-foreground">
								(unsaved)
							</span>
						)}
					</h1>
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
					<Link
						to="/dashboard/flows/$flowId/logs"
						params={{ flowId }}
						className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
					>
						<ScrollText className="size-3.5" />
						Logs
					</Link>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={!canUndo}
						onClick={handleUndo}
						title="Undo (Ctrl+Z)"
					>
						<Undo2 className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={!canRedo}
						onClick={handleRedo}
						title="Redo (Ctrl+Shift+Z)"
					>
						<Redo2 className="size-3.5" />
					</Button>
					<DeployDialog
						flowId={flowId}
						flowName={flow.name}
						disabled={nodes.length === 0}
					/>
					<Button
						size="sm"
						className="h-7 text-xs"
						onClick={handleSave}
						disabled={saveMut.isPending}
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
											draggable
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
							nodes={nodes}
							edges={edges}
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
						<NodeConfigPanel
							node={selectedNode}
							flowId={flowId}
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
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [deviceId, setDeviceId] = useState("");

	const { data: devices } = useSuspenseQuery(trpc.device.list.queryOptions());

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
						{devices.map((d) => (
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
										{d.phoneNumber ?? "No phone"} · {d.status}
									</span>
								</span>
							</Button>
						))}
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
						onClick={() => deployMut.mutate({ id: flowId, deviceId })}
					>
						{deployMut.isPending ? "Deploying..." : "Deploy"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
