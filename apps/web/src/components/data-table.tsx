import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@whatsapp-flow/ui/components/table";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import type { ReactNode } from "react";

type DataTableColumn<T> = {
	key: string;
	header: ReactNode;
	cell: (row: T) => ReactNode;
	className?: string;
	headClassName?: string;
};

type DataTableProps<T> = {
	columns: DataTableColumn<T>[];
	data: T[];
	getRowKey: (row: T) => string;
	className?: string;
};

export function DataTable<T>({
	columns,
	data,
	getRowKey,
	className,
}: DataTableProps<T>) {
	return (
		<Table className={cn("text-xs", className)}>
			<TableHeader>
				<TableRow className="hover:bg-transparent">
					{columns.map((column) => (
						<TableHead
							key={column.key}
							className={cn(
								"px-4 py-2 text-muted-foreground text-xs",
								column.headClassName,
							)}
						>
							{column.header}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{data.map((row) => (
					<TableRow key={getRowKey(row)}>
						{columns.map((column) => (
							<TableCell
								key={column.key}
								className={cn("px-4 py-2.5", column.className)}
							>
								{column.cell(row)}
							</TableCell>
						))}
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
