import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@whatsapp-flow/ui/components/button";
import { Input } from "@whatsapp-flow/ui/components/input";
import { Label } from "@whatsapp-flow/ui/components/label";
import { useEffect } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

import Loader from "./loader";

export default function SignUpForm({
	inviteToken,
	onSwitchToSignIn,
}: {
	inviteToken?: string;
	onSwitchToSignIn: () => void;
}) {
	const trpc = useTRPC();
	const navigate = useNavigate({
		from: "/",
	});
	const { isPending } = authClient.useSession();
	const inviteQuery = useQuery({
		...trpc.user.getInvite.queryOptions({ token: inviteToken ?? "" }),
		enabled: Boolean(inviteToken),
	});
	const acceptInvite = useMutation(trpc.user.acceptInvite.mutationOptions());

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
			confirmPassword: "",
			name: "",
		},
		onSubmit: async ({ value }) => {
			await authClient.signUp.email(
				{
					email: value.email.trim(),
					password: value.password,
					name: value.name.trim(),
					inviteToken,
				} as Parameters<typeof authClient.signUp.email>[0] & {
					inviteToken?: string;
				},
				{
					onSuccess: async () => {
						if (inviteToken) {
							await acceptInvite.mutateAsync({ token: inviteToken });
						}
						navigate({
							to: "/dashboard",
						});
						toast.success(
							inviteToken
								? "Sign up successful and invite accepted"
								: "Sign up successful",
						);
					},
					onError: (error) => {
						toast.error(error.error.message || error.error.statusText);
					},
				},
			);
		},
		validators: {
			onSubmit: z
				.object({
					name: z.string().trim().min(2, "Name must be at least 2 characters"),
					email: z.email("Invalid email address"),
					password: z.string().min(8, "Password must be at least 8 characters"),
					confirmPassword: z.string().min(1, "Confirm your password"),
				})
				.refine((value) => value.password === value.confirmPassword, {
					path: ["confirmPassword"],
					message: "Passwords do not match",
				}),
		},
	});

	useEffect(() => {
		if (inviteQuery.data?.email) {
			form.setFieldValue("email", inviteQuery.data.email);
		}
	}, [form, inviteQuery.data?.email]);

	const inviteReady = !inviteToken || Boolean(inviteQuery.data);

	if (isPending) {
		return <Loader />;
	}

	return (
		<div className="w-full">
			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					form.handleSubmit();
				}}
				className="space-y-4"
			>
				{inviteToken && (
					<div className="rounded-lg border bg-muted/50 p-3 text-sm">
						{inviteQuery.isPending ? (
							<p className="text-muted-foreground">Loading invite...</p>
						) : inviteQuery.data ? (
							<div className="space-y-1">
								<p className="font-medium">You are accepting an invite.</p>
								<p className="text-muted-foreground">
									{inviteQuery.data.email} will join as{" "}
									{inviteQuery.data.roleName}.
								</p>
							</div>
						) : (
							<p className="text-destructive">
								{inviteQuery.error?.message ?? "Invite is not valid."}
							</p>
						)}
					</div>
				)}

				<div>
					<form.Field name="name">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Name</Label>
								<Input
									id={field.name}
									name={field.name}
									autoComplete="name"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-destructive text-xs">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<div>
					<form.Field name="email">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Email</Label>
								<Input
									id={field.name}
									name={field.name}
									type="email"
									autoComplete="email"
									readOnly={Boolean(inviteToken)}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-destructive text-xs">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<div>
					<form.Field name="password">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Password</Label>
								<Input
									id={field.name}
									name={field.name}
									type="password"
									autoComplete="new-password"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-destructive text-xs">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<div>
					<form.Field name="confirmPassword">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Confirm password</Label>
								<Input
									id={field.name}
									name={field.name}
									type="password"
									autoComplete="new-password"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-destructive text-xs">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<form.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						isSubmitting: state.isSubmitting,
					})}
				>
					{({ canSubmit, isSubmitting }) => (
						<Button
							type="submit"
							className="w-full"
							disabled={!canSubmit || isSubmitting || !inviteReady}
						>
							{isSubmitting ? "Submitting..." : "Sign Up"}
						</Button>
					)}
				</form.Subscribe>
			</form>

			<div className="mt-4 text-center">
				<Button variant="link" onClick={onSwitchToSignIn}>
					Already have an account? Sign In
				</Button>
			</div>
		</div>
	);
}
