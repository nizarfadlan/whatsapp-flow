import { protectedProcedure, publicProcedure, router } from "../index";
import { auditRouter } from "./audit";
import { channelRouter } from "./channel";
import { contactRouter } from "./contact";
import { deviceRouter } from "./device";
import { flowRouter } from "./flow";
import { flowLogRouter } from "./flow-log";
import { flowSessionRouter } from "./flow-session";
import { groupRouter } from "./group";
import { inboxRouter } from "./inbox";
import { mediaRouter } from "./media";
import { settingsRouter } from "./settings";
import { userRouter } from "./user";
import { webhookRouter } from "./webhook";

export const appRouter = router({
	audit: auditRouter,
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
	channel: channelRouter,
	flow: flowRouter,
	flowLog: flowLogRouter,
	flowSession: flowSessionRouter,
	inbox: inboxRouter,
	media: mediaRouter,
	webhook: webhookRouter,
	settings: settingsRouter,
	user: userRouter,
});

export type AppRouter = typeof appRouter;
