import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@whatsapp-flow/ui/components/button";
import { Input } from "@whatsapp-flow/ui/components/input";
import { Label } from "@whatsapp-flow/ui/components/label";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

import Loader from "./loader";

function ProviderIcon({ iconUrl }: { iconUrl?: string | null }) {
	if (iconUrl) {
		return (
			<img
				src={iconUrl}
				alt=""
				aria-hidden="true"
				className="size-4 rounded-sm object-contain"
			/>
		);
	}

	return <KeyRound className="size-4" aria-hidden="true" />;
}

export default function SignInForm({
	onSwitchToSignUp,
	showSignup,
}: {
	onSwitchToSignUp: () => void;
	showSignup: boolean;
}) {
	const navigate = useNavigate({
		from: "/",
	});
	const trpc = useTRPC();
	const { isPending } = authClient.useSession();
	const { data: publicSettings } = useQuery(
		trpc.settings.public.queryOptions(),
	);
	const [socialProviderPending, setSocialProviderPending] = useState<
		string | null
	>(null);

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
		},
		onSubmit: async ({ value }) => {
			await authClient.signIn.email(
				{
					email: value.email,
					password: value.password,
				},
				{
					onSuccess: () => {
						navigate({
							to: "/dashboard",
						});
						toast.success("Sign in successful");
					},
					onError: (error) => {
						toast.error(error.error.message || error.error.statusText);
					},
				},
			);
		},
		validators: {
			onSubmit: z.object({
				email: z.email("Invalid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
			}),
		},
	});

	const providers = publicSettings?.auth.providers ?? [];
	const signInWithProvider = async (provider: {
		providerId: string;
		type: string;
	}) => {
		setSocialProviderPending(provider.providerId);
		const callbackURL = new URL(
			"/dashboard",
			window.location.origin,
		).toString();
		const errorCallbackURL = new URL(
			"/login",
			window.location.origin,
		).toString();
		const callbacks = {
			onError: (error: { error: { message?: string; statusText: string } }) => {
				setSocialProviderPending(null);
				toast.error(error.error.message || error.error.statusText);
			},
		};

		if (provider.type === "oidc") {
			await authClient.signIn.oauth2(
				{
					providerId: provider.providerId,
					callbackURL,
					errorCallbackURL,
				},
				callbacks,
			);
			return;
		}

		await authClient.signIn.social(
			{
				provider: provider.providerId,
				callbackURL,
				errorCallbackURL,
			},
			callbacks,
		);
	};

	if (isPending) {
		return <Loader />;
	}

	return (
		<div className="w-full">
			{providers.length > 0 && (
				<div className="mb-5 space-y-3">
					{providers.map((provider) => (
						<Button
							key={provider.providerId}
							type="button"
							variant="outline"
							className="w-full"
							disabled={Boolean(socialProviderPending)}
							onClick={() => signInWithProvider(provider)}
						>
							{socialProviderPending === provider.providerId ? (
								"Redirecting..."
							) : (
								<>
									<ProviderIcon iconUrl={provider.iconUrl} />
									Continue with {provider.displayName}
								</>
							)}
						</Button>
					))}
					<div className="relative py-1 text-center">
						<div className="absolute inset-x-0 top-1/2 border-t" />
						<span className="relative bg-card px-2 text-muted-foreground text-xs">
							or continue with email
						</span>
					</div>
				</div>
			)}

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					form.handleSubmit();
				}}
				className="space-y-4"
			>
				<div>
					<form.Field name="email">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Email</Label>
								<Input
									id={field.name}
									name={field.name}
									type="email"
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
							disabled={!canSubmit || isSubmitting}
						>
							{isSubmitting ? "Submitting..." : "Sign In"}
						</Button>
					)}
				</form.Subscribe>
			</form>

			{showSignup && (
				<div className="mt-4 text-center">
					<Button variant="link" onClick={onSwitchToSignUp}>
						Need an account? Sign Up
					</Button>
				</div>
			)}
		</div>
	);
}
