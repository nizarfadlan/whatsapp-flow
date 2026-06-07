import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Dialog,
	DialogCloseButton,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPopup,
	DialogPortal,
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
import { useTRPC } from "@/utils/trpc";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Play, Redo2, Save, ScrollText, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
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

export const Route = createFileRoute("/dashboard/flows/$flowId")({
	component: FlowEditor,
});

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
		<div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
			<div className="flex items-center justify-between">
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
					<span
						className={cn(
							"rounded-none px-1.5 py-0.5 text-[10px]",
							flow.status === "active"
								? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-400"
								: flow.status === "paused"
									? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-400"
									: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
						)}
					>
						{flow.status}
					</span>
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
					<button
						type="button"
						className="inline-flex size-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
						disabled={!canUndo}
						onClick={handleUndo}
						title="Undo (Ctrl+Z)"
					>
						<Undo2 className="size-3.5" />
					</button>
					<button
						type="button"
						className="inline-flex size-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
						disabled={!canRedo}
						onClick={handleRedo}
						title="Redo (Ctrl+Shift+Z)"
					>
						<Redo2 className="size-3.5" />
					</button>
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

			<div className="flex flex-1 gap-3 overflow-hidden">
				{/* Node Palette */}
				<div className="flex w-40 shrink-0 flex-col gap-3 overflow-y-auto border-r pr-2">
					<p className="text-[10px] text-muted-foreground">Add Nodes</p>
					{paletteCategories.map((cat) => (
						<div key={cat.label} className="flex flex-col gap-1">
							<p className="text-[9px] text-muted-foreground/60 uppercase tracking-wide">
								{cat.label}
							</p>
							{cat.items.map((item) => {
								const colorMap: Record<string, string> = {
									trigger: "border-green-500 bg-green-50 dark:bg-green-950",
									message: "border-purple-500 bg-purple-50 dark:bg-purple-950",
									media: "border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950",
									interactive:
										"border-orange-500 bg-orange-50 dark:bg-orange-950",
									logic: "border-blue-500 bg-blue-50 dark:bg-blue-950",
									action: "border-red-500 bg-red-50 dark:bg-red-950",
								};
								return (
									<button
										key={item.type}
										type="button"
										className={cn(
											"flex items-center gap-1.5 border-2 px-2 py-1 text-[10px] transition-colors hover:opacity-80",
											colorMap[item.category],
										)}
										draggable
										onDragStart={(e) => handlePaletteDragStart(e, item.type)}
										onClick={() => handleAddNode(item.type)}
									>
										<item.icon className="size-3" />
										{item.label}
									</button>
								);
							})}
						</div>
					))}
				</div>

				{/* Flow Canvas */}
				<div className="flex-1 border">
					<ReactFlow
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
						deleteKeyCode={null}
					>
						<Background variant={BackgroundVariant.Dots} gap={20} size={1} />
						<Controls className="rounded-none" />
						<MiniMap className="rounded-none" />
					</ReactFlow>
				</div>

				{/* Config Panel */}
				<div className="w-56 shrink-0 overflow-y-auto border-l">
					<NodeConfigPanel
						node={selectedNode}
						flowId={flowId}
						onUpdate={updateNodeData}
						onDelete={deleteNode}
					/>
				</div>
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
				className="inline-flex items-center gap-1.5 rounded-none bg-green-600 px-2.5 py-1 font-medium text-white text-xs hover:bg-green-700 disabled:opacity-50"
			>
				<Play className="size-3.5" />
				Deploy
			</DialogTrigger>
			<DialogPortal>
				<DialogPopup>
					<DialogCloseButton />
					<DialogHeader>
						<DialogTitle>Deploy Flow</DialogTitle>
						<DialogDescription>
							Select device to run this flow on.
						</DialogDescription>
					</DialogHeader>
					<DialogContent>
						{devices && devices.length > 0 ? (
							<div className="flex flex-col gap-1">
								{devices.map((d) => (
									<button
										key={d.id}
										type="button"
										className={cn(
											"rounded-none border px-3 py-2 text-left text-xs transition-colors hover:bg-muted",
											deviceId === d.id
												? "border-primary bg-primary/10"
												: "border-border",
										)}
										onClick={() => setDeviceId(d.id)}
									>
										<div className="font-medium">{d.name}</div>
										<div className="text-[10px] text-muted-foreground">
											{d.phoneNumber ?? "No phone"} · {d.status}
										</div>
									</button>
								))}
							</div>
						) : (
							<p className="text-muted-foreground text-xs">
								No devices available. Add device first.
							</p>
						)}
					</DialogContent>
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
				</DialogPopup>
			</DialogPortal>
		</Dialog>
	);
}
