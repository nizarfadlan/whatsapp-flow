import { protectedProcedure, publicProcedure, router } from "../index";
import { deviceRouter } from "./device";
import { flowRouter } from "./flow";
import { flowLogRouter } from "./flow-log";
import { inboxRouter } from "./inbox";

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
	flow: flowRouter,
	flowLog: flowLogRouter,
	inbox: inboxRouter,
});

export type AppRouter = typeof appRouter;
