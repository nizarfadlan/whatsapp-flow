import { protectedProcedure, publicProcedure, router } from "../index";
import { contactRouter } from "./contact";
import { deviceRouter } from "./device";
import { flowRouter } from "./flow";
import { flowLogRouter } from "./flow-log";
import { flowSessionRouter } from "./flow-session";
import { groupRouter } from "./group";
import { inboxRouter } from "./inbox";
import { mediaRouter } from "./media";
import { webhookRouter } from "./webhook";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => {
		return "OK";
	}),
	privateData: protectedProcedure.query(({ ctx }) => {
		return {
			message: "This is private",
			user: ctx.session.user,
		};
	}),
	device: deviceRouter,
	contact: contactRouter,
	group: groupRouter,
	flow: flowRouter,
	flowLog: flowLogRouter,
	flowSession: flowSessionRouter,
	inbox: inboxRouter,
	media: mediaRouter,
	webhook: webhookRouter,
});

export type AppRouter = typeof appRouter;
